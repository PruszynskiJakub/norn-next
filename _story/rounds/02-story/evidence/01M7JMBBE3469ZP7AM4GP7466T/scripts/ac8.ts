import { load, R, eq } from "./lib.ts";
const { renderBrief } = await import(`${R}/packages/core/src/brief.ts`);
const { stateFor, sliceUnit } = await import(`${R}/packages/core/test/fixtures.ts`);
const NEW = `name: wf
start: build
steps:
  build:
    agent: Build it.
    skills: [norn-implement]
    outcomes:
      done: review
      partial: review
      blocked: { to: build, counter: loop }
      silent: { to: build, counter: loop }
    means:
      done: "all criteria pass"
      partial: "some criteria unverified"
      blocked: "cannot proceed"
    verdict:
      done: pass
      partial: unverified
  review:
    gate: ok?
    outcomes: { approve: $done }
counters: { loop: { max: 2 } }
`;
const OLD = `name: wf
start: build
steps:
  build:
    type: agent
    skill: norn-implement
    instructions: Build it.
    outcomes:
      done: { to: review, means: "all criteria pass", verdict: pass }
      partial: { to: review, means: "some criteria unverified", verdict: unverified }
      blocked: { to: build, counter: loop, means: "cannot proceed" }
      silent: { to: build, counter: loop }
  review:
    type: gate
    prompt: ok?
    outcomes: { approve: $done }
counters: { loop: { max: 2 } }
`;
const U = sliceUnit("gh-1", "02", "form");
const brief = (wf: any) => renderBrief({ unit: U, state: stateFor(U, wf), workflow: wf, mode: "auto", runner: "herdr",
  paths: { worktree: "/w", spec_dir: ".agents/specs/gh-1", story_file: "s.md", slice_file: "x.md", unit_dir: "u" },
  diff_range: null, handoff: null, receipts: [], limits: { deadline: "60m", nudges: 2, retries: 1, slot: null, port_base: null } });
const n = load(NEW), o = load(OLD, "copy");
console.log("new ok", n.ok, JSON.stringify(n.issues), "| old copy ok", o.ok);
console.log("edges (new):", JSON.stringify(n.workflow.steps.build.outcomes));
const bn = brief(n.workflow), bo = brief(o.workflow);
const sect = (md: string) => md.slice(md.indexOf("## Finish with exactly one of"), md.indexOf("\n- `--handoff"));
console.log(sect(bn.markdown));
console.log("finish json equal:", eq(bn.json.finish, bo.json.finish), "| whole brief markdown equal:", bn.markdown === bo.markdown);
