// QA probe (not a repo test): drives the dev CLI in-process through the repo's harness (fake remote, fake runner)
// and prints what it sees; assertions are printed as JSON lines, not expect()ed, so every observation lands in the log.
import { setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { sha256 } from "@norn/core";
import { machineDir, parseWorkflowText, readState, recordErrors, translateWording, workflowsDir, writeState } from "@norn/store";
import { createHarness, type Harness, issue } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/test/support/harness.ts";
import { runStateOf } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/test/support/run-state.ts";

setDefaultTimeout(180_000);
const log = (label: string, v: unknown) => console.log(`>>> ${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

const ALT = `name: alt
start: draft
steps:
  draft:
    agent: Draft the change.
    skills: [norn-implement]
    outcomes: { done: review }
    means:
      done: "drafted"
  review:
    agent: Review it.
    outcomes: { ok: $done }
    means:
      ok: "fine"
`;
const ALT_OLD = `name: alt
start: draft
steps:
  draft:
    type: agent
    skill: norn-implement
    instructions: Draft the change.
    outcomes: { done: { to: review, means: "drafted" } }
  review:
    type: agent
    instructions: Review it.
    outcomes: { ok: { to: $done, means: "fine" } }
`;
const BAD = `name: oldy
start: a
steps:
  a:
    agent: Do it.
    outcomes: { done: $done }
`;
const OLDY = process.env.QA_BAD ? BAD : `name: oldy
start: a
steps:
  a:
    type: check
    run: "true"
    outcomes: { pass: $done, fail: $done }
`;
const USES = "name: uses\nstart: core\nsteps:\n  core: { use: core }\n  after:\n    gate: Ok?\n    outcomes: { approve: $done, reject: $done }\n";
const CORE = `start: build
steps:
  build:
    agent: Build it.
    skills: [norn-implement]
    outcomes: { done: { exit: built } }
    means:
      done: "built"
`;
const USES_FIXED = USES.replace("core: { use: core }", "core: { use: core, outcomes: { built: after } }");

async function setUp(files: Record<string, string>): Promise<Harness> {
  const t = await createHarness();
  if ((await t.norn("init")).exit !== 0) throw new Error("init failed");
  t.config("provider: gh\nworkflow: alt\nmode: auto\n");
  t.recordVersion();
  for (const [file, text] of Object.entries({ "alt.yaml": ALT, ...files })) t.write(join(workflowsDir(t.root), file), text);
  t.git(["add", "-A"]);
  t.git(["commit", "-q", "-m", "norn init"]);
  t.git(["push", "-q", "origin", "main"]);
  return t;
}
function hashTree(dir: string, skip: (rel: string) => boolean = () => false): { hash: string; files: number } {
  const h = createHash("sha256");
  let files = 0;
  if (!existsSync(dir)) return { hash: "absent", files: 0 };
  for (const p of (readdirSync(dir, { recursive: true }) as string[]).sort()) {
    const full = join(dir, p);
    if (skip(p) || !statSync(full).isFile()) continue;
    files++;
    h.update(p).update("\0").update(readFileSync(full)).update("\0");
  }
  return { hash: h.digest("hex"), files };
}
const next = (t: Harness) => {
  t.clock.advance(10_000);
  return t.tick();
};

test.skip("08.AC5 + 09.AC5: run state untouched by upgrade; an old-wording pin finishes its round", async () => {
  const t = await setUp({ "oldy.yaml": OLDY });
  try {
    t.remote.issues = [issue(51, "In flight")];
    const spec = ".agents/specs/gh-51-in-flight";
    const runs = () => runStateOf(join(t.worktree("gh-51-in-flight"), spec));
    for (let i = 0; i < 8 && t.state(runs())?.status !== "running"; i++) await next(t);
    log("state after start", t.state(runs()));
    // the pin an older norn wrote: old wording, its hash in state
    t.write(join(runs(), "workflow.yaml"), ALT_OLD);
    const st = readState(runs());
    if (!st.ok) throw new Error("no state");
    writeState(runs(), { ...st.value, workflow_hash: sha256(ALT_OLD) });
    t.report(runs(), "done", { outcome: "done", handoff: "drafted" });
    await next(t);
    log("09.AC5 state after done", { step: t.state(runs())?.step, status: t.state(runs())?.status, workflow_hash_is_old: t.state(runs())?.workflow_hash === sha256(ALT_OLD) });

    // 08.AC5: hash the machine dir's run state, then upgrade (oldy.yaml in the main checkout is old wording)
    const md = machineDir(t.root);
    log("machine dir", md);
    log("machine dir entries", readdirSync(md));
    const runsDir = join(md, "runs");
    log("runs files", (readdirSync(runsDir, { recursive: true }) as string[]).filter((p) => statSync(join(runsDir, p)).isFile()));
    const before = { runs: hashTree(runsDir), machine: hashTree(md) };
    const up = await t.norn("upgrade", "--json");
    const after = { runs: hashTree(runsDir), machine: hashTree(md) };
    log("08.AC5 upgrade exit", up.exit);
    log("08.AC5 upgrade workflows", (up.value as { workflows: unknown }).workflows);
    log("08.AC5 runs hash before", before.runs);
    log("08.AC5 runs hash after", after.runs);
    log("08.AC5 runs same", before.runs.hash === after.runs.hash);
    log("08.AC5 whole machine dir same", before.machine.hash === after.machine.hash);
    t.git(["commit", "-q", "-m", "upgrade"]);
    t.git(["push", "-q", "origin", "main"]);

    // 09.AC5 continued: finish the round on the old pin
    t.report(runs(), "done", { outcome: "ok", handoff: "fine" });
    for (let i = 0; i < 3 && t.state(runs())?.step !== "$done"; i++) await next(t);
    const s = t.state(runs());
    log("09.AC5 final state", { step: s?.step, status: s?.status, hash_is_old: s?.workflow_hash === sha256(ALT_OLD) });
    log("09.AC5 pin verbatim old", t.read(join(runs(), "workflow.yaml")) === ALT_OLD);
    log("09.AC5 recordErrors", recordErrors(runs()));
    const view = await t.norn("story", "view", "gh-51", "--json");
    log("09.AC5 story view exit", view.exit);
    log("09.AC5 story view", JSON.stringify(view.value).slice(0, 600));
    const runList = await t.norn("run", "list", "--json");
    log("09.AC5 run list exit", runList.exit);
    log("09.AC5 run list", JSON.stringify(runList.value).slice(0, 600));
  } finally {
    t.cleanup();
  }
});

test("09.AC4: an old-wording main-checkout workflow starts no round; sync and status report it", async () => {
  const t = await setUp({ "oldy.yaml": OLDY });
  try {
    t.remote.issues = [issue(31, "Edit me")];
    const spec = ".agents/specs/gh-31-edit-me";
    const runs = () => runStateOf(join(t.worktree("gh-31-edit-me"), spec));
    for (let i = 0; i < 8 && t.state(runs())?.status !== "running"; i++) await next(t);
    t.report(runs(), "done", { outcome: "done", handoff: "d" });
    await next(t);
    t.report(runs(), "done", { outcome: "ok", handoff: "f" });
    for (let i = 0; i < 4 && t.state(runs())?.step !== "$done"; i++) await next(t);
    const s0 = t.state(runs());
    log("gh-31 round 1", { step: s0?.step, status: s0?.status, workflow: s0?.workflow, round: (s0 as { round?: number })?.round });
    const edit = await t.norn("story", "edit", "gh-31", "--workflow", "oldy", "--json");
    log("story edit exit", edit.exit);
    log("story edit value", edit.value);
    await next(t);
    const s1 = t.state(runs());
    log("gh-31 after edit + tick", { step: s1?.step, status: s1?.status, workflow: s1?.workflow, round: (s1 as { round?: number })?.round });

    t.remote.issues = [...t.remote.issues, issue(7, "Old", ["norn", "norn:wf:oldy"])];
    const rules: string[] = [];
    for (let i = 0; i < 3; i++) rules.push(...(await next(t)).decisions.filter((d) => d.unit === "gh-7").map((d) => d.rule));
    log("gh-7 tick rules", [...new Set(rules)]);
    log("gh-7 worktree exists", existsSync(t.worktree("gh-7-old")));
    log("gh-7 notifier", t.notifier.items.filter((i) => i.story === "gh-7").map((i) => i.title));
    const sync = await t.norn("sync", "--json");
    log("sync exit", sync.exit);
    log("sync value", JSON.stringify(sync.value).slice(0, 1500));
    const syncMd = await t.norn("sync");
    log("sync md", syncMd.stdout.slice(0, 1500));
    const status = await t.norn("status", "--json");
    log("status json gh-7", JSON.stringify(status.value).match(/[^{}]*gh-7[^{}]*/g)?.slice(0, 4));
    const rules2: string[] = [];
    for (let i = 0; i < 4; i++) rules2.push(...(await next(t)).decisions.filter((d) => d.unit === "gh-7").map((d) => `${d.rule}:${d.kind}`));
    log("gh-7 later tick rules", rules2);
    log("gh-7 worktree exists later", existsSync(t.worktree("gh-7-old")));
    log("gh-7 notifier later", t.notifier.items.filter((i) => i.story === "gh-7").map((i) => i.title));
    const sync2 = await t.norn("sync", "--json");
    log("sync2 value", JSON.stringify(sync2.value).slice(0, 2500));
    const sync2md = await t.norn("sync");
    log("sync2 md", sync2md.stdout.slice(0, 2500));
    const status2 = await t.norn("status", "--json");
    log("status2 json gh-7", JSON.stringify(status2.value).match(/[^{}]*gh-7[^{}]*/g)?.slice(0, 4));
    const statusMd = await t.norn("status");
    log("status md", statusMd.stdout.slice(0, 2000));
  } finally {
    t.cleanup();
  }
});

test.skip("09.AC7: a new unit pins its workflow flattened in the new wording", async () => {
  const t = await setUp({ "uses.yaml": USES_FIXED, "shared/core.yaml": CORE });
  try {
    t.remote.issues = [issue(61, "Fresh", ["norn", "norn:wf:uses"])];
    const spec = ".agents/specs/gh-61-fresh";
    const runs = () => runStateOf(join(t.worktree("gh-61-fresh"), spec));
    for (let i = 0; i < 8 && t.state(runs())?.status !== "running"; i++) await next(t);
    const pin = existsSync(join(runs(), "workflow.yaml")) ? t.read(join(runs(), "workflow.yaml")) : "(no pin)";
    log("09.AC7 state", { step: t.state(runs())?.step, status: t.state(runs())?.status });
    log("09.AC7 pin", pin);
    log("09.AC7 pin has use:", /\buse:/.test(pin));
    const tr = translateWording(pin, "workflow.yaml");
    log("09.AC7 translateWording ok/changed", { ok: tr.ok, changed: (tr as { changed?: boolean }).changed });
    log("09.AC7 checkout-parse ok", parseWorkflowText(pin, "workflow.yaml", "checkout").ok);
    log("09.AC7 hash matches", t.state(runs())?.workflow_hash === sha256(pin));
  } finally {
    t.cleanup();
  }
});
