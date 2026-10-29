import { describe, expect, test } from "bun:test";
import { cmd, nameRemoved } from "@norn/core";

// B7: every command norn prints is built by one `cmd` builder. This table pins each builder's
// string for a sample unit, so renaming a command is one reviewed diff of this table and the module.
// B5, B7: none of them names a removed command.
const U = "gh-12/03";
const S = "gh-12";
const today: Record<keyof typeof cmd, [string, ...string[]]> = {
  config: ["norn config list", cmd.config()],
  ask: [`norn ask "<question>"`, cmd.ask()],
  brief: ["norn brief", cmd.brief()],
  doctor: ["norn doctor", cmd.doctor(), "norn doctor --json", cmd.doctor({ json: true })],
  done: [`norn done approve --handoff "…"`, cmd.done("approve"), `norn done pass --criteria <file> --handoff "…"`, cmd.done("pass", { criteria: true })],
  help: ["norn help", cmd.help()],
  init: ["norn init", cmd.init()],
  status: ["norn status", cmd.status(), "norn status --notes", cmd.status({ notes: true }), "norn status --history --since 1d", cmd.status({ since: "1d" })],
  statusWatch: ["norn status --watch", cmd.statusWatch(), "norn status --watch --interval 5s", cmd.statusWatch({ interval: "5s" })],
  storyAnswer: [`norn story answer ${U} "…"`, cmd.storyAnswer(U), `norn story answer ${U} "1"`, cmd.storyAnswer(U, "1")],
  storyApprove: [`norn story approve ${U}`, cmd.storyApprove(U)],
  storyReject: [`norn story reject ${U} --reason "…"`, cmd.storyReject(U)],
  storyUpdateBranch: [`norn story update-branch ${S}`, cmd.storyUpdateBranch(S), "norn story update-branch", cmd.storyUpdateBranch()],
  storyChat: [`norn story chat ${S}`, cmd.storyChat(S), "norn story chat", cmd.storyChat()],
  storyEdit: [
    `norn story edit ${S} --auto`,
    cmd.storyEdit(S, { mode: "auto" }),
    `norn story edit ${U} --workflow fix --at <a|b>`,
    cmd.storyEdit(U, { workflow: "fix", at: "<a|b>" }),
    `norn story edit ${S} --workflow <name>`,
    cmd.storyEdit(S, { workflow: "<name>" }),
  ],
  storyStart: [`norn story start ${U}`, cmd.storyStart(U), "norn story start", cmd.storyStart(), `norn story start ${U} --print`, cmd.storyStart(U, { print: true })],
  storyView: [`norn story view ${U}`, cmd.storyView(U), `norn story view ${S} --web`, cmd.storyView(S, { web: true })],
  stuck: [`norn stuck "<reason>"`, cmd.stuck(), `norn stuck "<why>"`, cmd.stuck("<why>")],
  storyCheckout: [`norn story checkout ${S}`, cmd.storyCheckout(S), `norn story checkout ${S} --force`, cmd.storyCheckout(S, { force: true })],
  storyClose: [`norn story close ${S}`, cmd.storyClose(S), `norn story close ${S} --yes`, cmd.storyClose(S, { yes: true }), "norn story close", cmd.storyClose()],
  storyHandoff: [`norn story handoff ${S}`, cmd.storyHandoff(S), "norn story handoff", cmd.storyHandoff()],
  storyReopen: [`norn story reopen ${S}`, cmd.storyReopen(S), "norn story reopen", cmd.storyReopen()],
  runList: [`norn run list ${U}`, cmd.runList(U), `norn run list ${U} --limit 20`, cmd.runList(U, { limit: 20 })],
  runAttach: [`norn run attach ${U}`, cmd.runAttach(U), "norn run attach --next", cmd.runAttach(undefined, { next: true })],
  runView: [
    `norn run view ${U}`,
    cmd.runView(U),
    "norn run view <unit> --why",
    cmd.runView(undefined, { why: true }),
    `norn run view ${U} --why --tick T1`,
    cmd.runView(U, { why: true, tick: "T1" }),
    `norn run view ${U} --receipt R1`,
    cmd.runView(U, { receipt: "R1" }),
  ],
  runRerun: [
    `norn run rerun ${U}`,
    cmd.runRerun(U),
    `norn run rerun ${U} --step <a|b>`,
    cmd.runRerun(U, { step: "<a|b>" }),
    `norn run rerun ${U} --reset <a|b>`,
    cmd.runRerun(U, { reset: "<a|b>" }),
    "norn run rerun",
    cmd.runRerun(),
  ],
  runCancel: [`norn run cancel ${U}`, cmd.runCancel(U), "norn run cancel", cmd.runCancel()],
  storyCreate: [`norn story create --title "…"`, cmd.storyCreate(), `norn story create --title "…" --workflow <a|b>`, cmd.storyCreate({ workflow: "<a|b>" })],
  sync: ["norn sync", cmd.sync()],
  tick: ["norn tick", cmd.tick()],
  tidy: ["norn tidy", cmd.tidy(), "norn tidy --dry-run", cmd.tidy({ dryRun: true })],
  watch: ["norn watch", cmd.watch(), "norn watch --interval 30s", cmd.watch({ interval: "30s" }), "norn watch --max-ticks 10", cmd.watch({ maxTicks: 10 })],
};

describe("printed commands (B7)", () => {
  test("the table covers every builder the module exports", () => {
    expect(Object.keys(today).sort()).toEqual(Object.keys(cmd).sort());
  });
  for (const [name, pairs] of Object.entries(today)) {
    test(`${name} prints today's string`, () => {
      for (let i = 0; i < pairs.length; i += 2) expect(pairs[i + 1]).toBe(pairs[i]);
    });
  }
  test("no builder prints a removed command (B5)", () => {
    for (const [name, pairs] of Object.entries(today)) for (const printed of pairs) expect({ name, removed: nameRemoved(printed) }).toEqual({ name, removed: null });
  });
  test("the removed-command check catches each old verb, and not its new spelling", () => {
    for (const old of ["drop gh-1", "inbox", "cockpit --next", "orient --open", "open gh-1", `answer gh-1 "x"`, "approve gh-1", "unstick gh-1 --to qa", "update gh-1", "mode auto", "workflow gh-1 fix", "take gh-1", "release gh-1", "trace gh-1", "why gh-1"])
      expect(nameRemoved(`run \`norn ${old}\` now`)).toBe(`norn ${old.split(" ")[0]}`);
    for (const ok of ["norn story update-branch gh-1", "norn done approve", "norn story approve gh-1", "norn status --watch", ".agents/norn/trace/x"]) expect(nameRemoved(ok)).toBeNull();
  });
});
