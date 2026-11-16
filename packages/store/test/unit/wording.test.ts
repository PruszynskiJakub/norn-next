import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { translateWording } from "../../src/index.ts";

const SHIPPED = join(import.meta.dir, "../../../cli/assets/workflows");
const EXPECTED = join(import.meta.dir, "../fixtures/wording");

function ok(text: string, file = "wf.yaml"): string {
  const r = translateWording(text, file);
  if (!r.ok) throw new Error(`refused: ${r.file}:${r.line} ${r.message}`);
  return r.text;
}

function refused(text: string, file = "wf.yaml") {
  const r = translateWording(text, file);
  if (r.ok) throw new Error(`translated:\n${r.text}`);
  return r;
}

const shippedFiles = [
  ...readdirSync(SHIPPED).filter((f) => f.endsWith(".yaml")),
  ...readdirSync(join(SHIPPED, "shared")).map((f) => `shared/${f}`),
];

describe("translateWording: the shipped workflows and shared files", () => {
  test("every shipped file has an expected translation", () => {
    expect(shippedFiles.length).toBe(9);
  });

  for (const f of shippedFiles)
    test(`${f} translates byte for byte to its expected file`, () => {
      const out = ok(readFileSync(join(SHIPPED, f), "utf8"), f);
      expect(out).toBe(readFileSync(join(EXPECTED, f), "utf8"));
    });

  for (const f of shippedFiles)
    test(`${f}'s translation translates to itself`, () => {
      const once = readFileSync(join(EXPECTED, f), "utf8");
      expect(ok(once, f)).toBe(once);
    });
});

describe("translateWording: a step's head key", () => {
  test("an agent step's skill and instructions become `agent:` (word for word) and `skills: [X]`", () => {
    const text = `steps:
  implement:
    type: agent
    skill: norn-implement
    inputs: [spec, handoff]
    instructions: "Write the PR body to pr.md; keep it short."
    outcomes: { done: { to: $done, means: "pr.md written" } }
`;
    expect(ok(text)).toBe(`steps:
  implement:
    agent: "Write the PR body to pr.md; keep it short."
    skills: [norn-implement]
    inputs: [spec, handoff]
    outcomes: { done: $done }
    means:
      done: "pr.md written"
`);
  });

  test("the head takes the step's first key position even when `type` is written later", () => {
    const text = `steps:
  test:
    timeout: 10m
    type: check
    run: bun test
    outcomes: { pass: $done }
`;
    expect(ok(text)).toBe(`steps:
  test:
    check: bun test
    timeout: 10m
    outcomes: { pass: $done }
`);
  });

  test("a step's `agent: <name>` becomes `by: <name>`", () => {
    const text = `steps:
  review:
    type: agent
    agent: codex
    skill: norn-review
    instructions: Review it.
    outcomes: { approve: { to: $done, means: "fine" } }
`;
    expect(ok(text)).toBe(`steps:
  review:
    agent: Review it.
    by: codex
    skills: [norn-review]
    outcomes: { approve: $done }
    means:
      approve: "fine"
`);
  });

  test("git, merge and slices steps become their value-less verbs", () => {
    const text = `steps:
  a:
    type: git
    action: update
    outcomes: { done: b }
  b:
    type: git
    action: open-pr
    outcomes: { done: c }
  c:
    type: git
    action: integrate
    outcomes: { done: d }
  d:
    type: git
    action: push
    outcomes: { done: e }
  e:
    type: slices
    outcomes: { done: f }
  f:
    type: merge
`;
    expect(ok(text)).toBe(`steps:
  a:
    update-branch:
    outcomes: { done: b }
  b:
    open-pr:
    outcomes: { done: c }
  c:
    integrate:
    outcomes: { done: d }
  d:
    push:
    outcomes: { done: e }
  e:
    slices:
    outcomes: { done: f }
  f:
    await-merge:
`);
  });

  test("a `like` copy's `agent: <name>` becomes `by: <name>` in a file in the old wording", () => {
    const text = `steps:
  review:
    type: agent
    skill: s
    instructions: Review.
    outcomes: { approve: { to: $done, means: fine } }
  review-codex:
    like: review
    agent: codex
  review-gemini:
    like: review
    skill: t
    agent: gemini
`;
    expect(ok(text)).toBe(`steps:
  review:
    agent: Review.
    skills: [s]
    outcomes: { approve: $done }
    means:
      approve: fine
  review-codex:
    like: review
    by: codex
  review-gemini:
    like: review
    skills: [t]
    by: gemini
`);
  });

  test("a `like` copy keeps its place and renames the keys it overrides", () => {
    const text = `steps:
  test:
    type: check
    run: bun test
    outcomes: { pass: $done }
  test-fast:
    like: test
    run: bun test --bail
`;
    expect(ok(text)).toBe(`steps:
  test:
    check: bun test
    outcomes: { pass: $done }
  test-fast:
    like: test
    check: bun test --bail
`);
  });
});

describe("translateWording: fallbacks", () => {
  test("an agent step with a skill and no instructions takes its description as its orientation", () => {
    const text = `steps:
  qa:
    type: agent
    skill: norn-qa
    description: >-
      Check the story
      from the user's side.
    outcomes: { pass: { to: $done, means: "ok" } }
`;
    expect(ok(text)).toBe(`steps:
  qa:
    agent: >-
      Check the story
      from the user's side.
    skills: [norn-qa]
    description: >-
      Check the story
      from the user's side.
    outcomes: { pass: $done }
    means:
      pass: "ok"
`);
  });

  test("with no description either, the orientation names the skill", () => {
    const text = `steps:
  qa:
    type: agent
    skill: norn-qa
    outcomes: { pass: { to: $done, means: "ok" } }
`;
    expect(ok(text)).toContain("    agent: Use the `norn-qa` skill.\n    skills: [norn-qa]\n");
  });

  test("a gate with no prompt takes its description, or `approve or reject <step>`", () => {
    const text = `steps:
  ready:
    type: gate
    description: "Read the draft PR."
    outcomes: { approve: hold }
  hold:
    type: gate
    outcomes: { approve: $done }
`;
    expect(ok(text)).toBe(`steps:
  ready:
    gate: "Read the draft PR."
    description: "Read the draft PR."
    outcomes: { approve: hold }
  hold:
    gate: approve or reject hold
    outcomes: { approve: $done }
`);
  });

  test("a routed outcome an agent may report with no meaning gets today's brief text; route overrides get none", () => {
    const text = `steps:
  resolve:
    type: agent
    skill: merge
    instructions: Merge it.
    outcomes: { done: test, stuck: $stuck, gave_up: { exit: broken, means: "cannot resolve", verdict: fail } }
`;
    expect(ok(text)).toBe(`steps:
  resolve:
    agent: Merge it.
    skills: [merge]
    outcomes: { done: test, stuck: $stuck, gave_up: { exit: broken } }
    means:
      done: step finished with outcome done
      gave_up: "cannot resolve"
    verdict:
      gave_up: fail
`);
  });
});

describe("translateWording: outcomes, meanings and verdicts", () => {
  test("a long edge keeps to/counter in outcomes, means and verdict follow, its comment stays on the outcome's line", () => {
    const text = `steps:
  qa:
    type: agent
    skill: norn-qa
    instructions: Check it.
    outcomes:
      pass:       { to: describe, verdict: pass, means: "every criterion observed" }   # the happy path
      fail:       { to: implement, counter: qa_loop, verdict: fail, means: "a criterion fails" }
    criteria: required
`;
    expect(ok(text)).toBe(`steps:
  qa:
    agent: Check it.
    skills: [norn-qa]
    outcomes:
      pass:       describe   # the happy path
      fail:       { to: implement, counter: qa_loop }
    means:
      pass: "every criterion observed"
      fail: "a criterion fails"
    verdict:
      pass: pass
      fail: fail
    criteria: required
`);
  });

  test("a block edge splits the same way", () => {
    const text = `steps:
  qa:
    type: agent
    skill: norn-qa
    instructions: Check it.
    outcomes:
      pass:
        to: describe
        counter: loop
        means: >-
          every criterion
          observed
`;
    expect(ok(text)).toBe(`steps:
  qa:
    agent: Check it.
    skills: [norn-qa]
    outcomes:
      pass:
        to: describe
        counter: loop
    means:
      pass: >-
          every criterion
          observed
`);
  });

  test("a comment on a block edge's outcome key stays on that line when the edge becomes its bare target", () => {
    const text = `steps:
  qa:
    type: agent
    skill: s
    instructions: Check it.
    outcomes:
      pass: # the happy path: all green
        to: describe
        means: ok
`;
    expect(ok(text)).toBe(`steps:
  qa:
    agent: Check it.
    skills: [s]
    outcomes:
      pass: describe # the happy path: all green
    means:
      pass: ok
`);
  });

  test("a meaning on a step that is not an agent step is dropped: nothing ever read it", () => {
    const text = `steps:
  test:
    type: check
    run: bun test
    outcomes:
      pass: { exit: tested, means: "the suite is green" }
`;
    expect(ok(text)).toBe(`steps:
  test:
    check: bun test
    outcomes:
      pass: { exit: tested }
`);
  });
});

describe("translateWording: text kept as written", () => {
  test("folded, block and quoted scalars and long lines are neither re-wrapped nor restyled", () => {
    const long = "x".repeat(150);
    const text = `# a comment on top
name: s   # trailing
description: >-
  A folded description
  over two lines.
start: a
steps:
  # before a
  a:
    type: agent
    skill: s
    instructions: >-
      ${long} ${long}
      and a second line.
    inputs: [spec,   handoff]
    outcomes:
      done: { to: b, means: 'single ${long}' }
  b:
    type: check
    run: |
      echo "${long}"
      exit 0
    outcomes: { pass: $done }
`;
    expect(ok(text)).toBe(`# a comment on top
name: s   # trailing
description: >-
  A folded description
  over two lines.
start: a
steps:
  # before a
  a:
    agent: >-
      ${long} ${long}
      and a second line.
    skills: [s]
    inputs: [spec,   handoff]
    outcomes:
      done: b
    means:
      done: 'single ${long}'
  b:
    check: |
      echo "${long}"
      exit 0
    outcomes: { pass: $done }
`);
  });

  test("a block scalar ending in a `#` line just above a removed key keeps that line", () => {
    const text = `steps:
  a:
    description: |
      text
      # not a comment
    type: check
    run: |
      set -e
      # also not a comment
    outcomes: { pass: $done }
`;
    expect(ok(text)).toBe(`steps:
  a:
    check: |
      set -e
      # also not a comment
    description: |
      text
      # not a comment
    outcomes: { pass: $done }
`);
  });

  test("a multi-line meaning that would have to move to a shallower indent is refused, never reflowed", () => {
    const text = `steps:
  a:
    type: agent
    skill: s
    instructions: Do it.
    outcomes: { done: { to: $done, means: "one
      two" } }
`;
    const r = refused(text, "x.yaml");
    expect(r.file).toBe("x.yaml");
    expect(r.line).toBe(6);
  });

  test("comments on the removed keys move to the head", () => {
    const text = `steps:
  a:
    type: agent # an agent
    skill: s
    # what it does
    instructions: Do it.
    outcomes: { done: { to: $done, means: "m" } }
`;
    expect(ok(text)).toBe(`steps:
  a:
    # what it does
    agent: Do it. # an agent
    skills: [s]
    outcomes: { done: $done }
    means:
      done: "m"
`);
  });
});

describe("translateWording: comments on the head line", () => {
  test("a comment on `type` goes after a quoted orientation holding a `#`, and after a block scalar's header", () => {
    const text = `steps:
  a:
    type: agent # one
    skill: s
    instructions: "post the ## Triage comment"
    outcomes: { done: { to: b, means: "m" } }
  b:
    type: check # two
    run: |
      bun test
    outcomes: { pass: $done }
`;
    expect(ok(text)).toBe(`steps:
  a:
    agent: "post the ## Triage comment" # one
    skills: [s]
    outcomes: { done: b }
    means:
      done: "m"
  b:
    check: | # two
      bun test
    outcomes: { pass: $done }
`);
  });
});

describe("translateWording: refusals", () => {
  test("a comment left with no line to sit on refuses the file, naming the file and the comment's line", () => {
    const text = `name: s
steps:
  a:
    type: agent # an agent
    skill: s
    instructions: Do it. # and its orientation
    outcomes: { done: { to: $done, means: "m" } }
`;
    const r = refused(text, ".agents/workflows/s.yaml");
    expect(r).toMatchObject({ file: ".agents/workflows/s.yaml", line: 4 });
    expect(r.message).toContain("comment");
  });
});

describe("translateWording: idempotence and new wording", () => {
  test("a translated text comes back unchanged", () => {
    const text = `steps:
  a:
    type: agent # an agent
    skill: s
    instructions: Do it.
    outcomes: { done: { to: $done, means: "m" }, stuck: $stuck }
`;
    const once = ok(text);
    expect(ok(once)).toBe(once);
  });

  test("a text in the new wording comes back unchanged", () => {
    const text = `name: q
steps:
  a:
    agent: Do it.
    by: codex
    outcomes: { done: b }
    means: { done: "m" }
  b:
    check: bun test
    outcomes: { pass: $done }
`;
    expect(ok(text)).toBe(text);
  });
});

describe("translateWording: JSON stays JSON", () => {
  test("a JSON workflow is written back as JSON with two-space indent in its key order", () => {
    const text = `{"name":"j","start":"a","steps":{"a":{"type":"agent","skill":"s","instructions":"Do it.","outcomes":{"done":{"to":"b","means":"m","verdict":"pass"},"stuck":"$stuck"},"deadline":"5m"},"b":{"type":"git","action":"push","outcomes":{"done":"$done"}}}}\n`;
    const out = ok(text, "j.json");
    expect(out).toBe(`${JSON.stringify(
      {
        name: "j",
        start: "a",
        steps: {
          a: {
            agent: "Do it.",
            skills: ["s"],
            outcomes: { done: "b", stuck: "$stuck" },
            means: { done: "m" },
            verdict: { done: "pass" },
            deadline: "5m",
          },
          b: { push: null, outcomes: { done: "$done" } },
        },
      },
      null,
      2,
    )}\n`);
    expect(ok(out, "j.json")).toBe(out);
  });

  test("a JSON `like` copy's `agent: <name>` becomes `by: <name>`", () => {
    const text = `{"steps":{"a":{"type":"check","run":"x","outcomes":{"pass":"$done"}},"b":{"like":"a","agent":"codex"}}}`;
    expect(JSON.parse(ok(text, "j.json")).steps.b).toEqual({ like: "a", by: "codex" });
  });
});
