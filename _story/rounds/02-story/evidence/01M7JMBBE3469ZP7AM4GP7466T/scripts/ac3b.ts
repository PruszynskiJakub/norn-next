import { load, show, eq } from "./lib.ts";
const SH_NEW = `description: d\nstart: rv\nsteps:\n  rv:\n    agent: Review it.\n    skills: [norn-review]\n    outcomes: { approve: { exit: ok }, changes_requested: { exit: bad } }\n    means: { approve: "fine", changes_requested: "findings" }\n  t:\n    check: bun test\n    timeout: 5m\n    outcomes: { pass: { exit: ok }, fail: { exit: bad } }\n`;
const SH_OLD = `description: d\nstart: rv\nsteps:\n  rv:\n    type: agent\n    skill: norn-review\n    instructions: Review it.\n    outcomes: { approve: { exit: ok, means: "fine" }, changes_requested: { exit: bad, means: "findings" } }\n  t:\n    type: check\n    run: bun test\n    timeout: 5m\n    outcomes: { pass: { exit: ok }, fail: { exit: bad } }\n`;
const WF_NEW = `name: wf\nstart: b\nsteps:\n  b:\n    agent: Build.\n    outcomes: { done: r }\n    means: { done: built }\n  r:\n    use: rev\n    outcomes: { ok: $done, bad: { to: b, counter: c } }\ncounters: { c: { max: 2 } }\n`;
const WF_OLD = `name: wf\nstart: b\nsteps:\n  b:\n    type: agent\n    instructions: Build.\n    outcomes: { done: { to: r, means: built } }\n  r:\n    use: rev\n    outcomes: { ok: $done, bad: { to: b, counter: c } }\ncounters: { c: { max: 2 } }\n`;
const n = load(WF_NEW, "checkout", { rev: SH_NEW }); const o = load(WF_OLD, "copy", { rev: SH_OLD });
show("new wording with use: (checkout)", { ok: n.ok, refused: n.refused, issues: n.issues, steps: n.workflow?.steps });
console.log("old wording with use: (copy) ok:", o.ok, "| models equal:", eq(n.workflow, o.workflow));
