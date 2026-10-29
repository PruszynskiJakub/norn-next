import { describe, expect, test } from "bun:test";
import { cmd } from "@norn/core";

// B7: every command norn prints is built by one `cmd` builder. This table pins each builder's
// string for a sample unit, so renaming a command is one reviewed diff of this table and the module.
const U = "gh-12/03";
const S = "gh-12";
const today: Record<keyof typeof cmd, [string, ...string[]]> = {
  config: ["norn config", cmd.config()],
  answer: [`norn answer ${U} "…"`, cmd.answer(U), `norn answer ${U} "1"`, cmd.answer(U, "1")],
  approve: [`norn approve ${U}`, cmd.approve(U), `norn approve ${U} --reject --reason "…"`, cmd.approve(U, { reject: true })],
  ask: [`norn ask "<question>"`, cmd.ask()],
  brief: ["norn brief", cmd.brief()],
  doctor: ["norn doctor", cmd.doctor(), "norn doctor --json", cmd.doctor({ json: true })],
  done: [`norn done approve --handoff "…"`, cmd.done("approve"), `norn done pass --criteria <file> --handoff "…"`, cmd.done("pass", { criteria: true })],
  help: ["norn help", cmd.help()],
  inbox: ["norn inbox", cmd.inbox(), "norn inbox --notes", cmd.inbox({ notes: true }), "norn inbox --history --since 1d", cmd.inbox({ since: "1d" })],
  init: ["norn init", cmd.init()],
  open: [`norn open ${U}`, cmd.open(U), "norn open", cmd.open()],
  status: ["norn status", cmd.status(), `norn status ${S}`, cmd.status(S)],
  statusWatch: ["norn status --watch", cmd.statusWatch(), "norn status --watch --interval 5s", cmd.statusWatch({ interval: "5s" })],
  storyChat: [`norn story chat ${S}`, cmd.storyChat(S), "norn story chat", cmd.storyChat()],
  storyEdit: [`norn story edit ${S} --auto`, cmd.storyEdit(S, { mode: "auto" }), `norn story edit ${U} --workflow fix --at <a|b>`, cmd.storyEdit(U, { workflow: "fix", at: "<a|b>" })],
  storyStart: [`norn story start ${U}`, cmd.storyStart(U), "norn story start", cmd.storyStart(), `norn story start ${U} --print`, cmd.storyStart(U, { print: true })],
  storyView: [`norn story view ${U}`, cmd.storyView(U), `norn story view ${S} --web`, cmd.storyView(S, { web: true })],
  stuck: [`norn stuck "<reason>"`, cmd.stuck(), `norn stuck "<why>"`, cmd.stuck("<why>")],
  storyCheckout: [`norn story checkout ${S}`, cmd.storyCheckout(S), `norn story checkout ${S} --force`, cmd.storyCheckout(S, { force: true })],
  storyClose: [`norn story close ${S}`, cmd.storyClose(S), `norn story close ${S} --yes`, cmd.storyClose(S, { yes: true }), "norn story close", cmd.storyClose()],
  storyHandoff: [`norn story handoff ${S}`, cmd.storyHandoff(S), "norn story handoff", cmd.storyHandoff()],
  runList: [`norn run list ${U}`, cmd.runList(U), `norn run list ${U} --limit 20`, cmd.runList(U, { limit: 20 })],
  runAttach: [`norn run attach ${U}`, cmd.runAttach(U), "norn run attach --next", cmd.runAttach(undefined, { next: true })],
  runView: [`norn run view ${U}`, cmd.runView(U), "norn run view <unit> --why", cmd.runView(undefined, { why: true })],
  sync: ["norn sync", cmd.sync()],
  tick: ["norn tick", cmd.tick()],
  tidy: ["norn tidy", cmd.tidy(), "norn tidy --dry-run", cmd.tidy({ dryRun: true })],
  trace: [`norn trace ${U}`, cmd.trace(U), `norn trace ${U} --limit 20`, cmd.trace(U, { limit: 20 })],
  unstick: [`norn unstick ${U}`, cmd.unstick(U), `norn unstick ${U} --to <step>`, cmd.unstick(U, { to: "<step>" }), `norn unstick ${U} --reset <a|b>`, cmd.unstick(U, { reset: "<a|b>" }), "norn unstick", cmd.unstick()],
  update: [`norn update ${S}`, cmd.update(S), "norn update", cmd.update()],
  watch: ["norn watch", cmd.watch(), "norn watch --interval 30s", cmd.watch({ interval: "30s" }), "norn watch --max-ticks 10", cmd.watch({ maxTicks: 10 })],
  why: [`norn why ${U}`, cmd.why(U), `norn why ${U} --tick T1`, cmd.why(U, { tick: "T1" }), `norn why ${U} --receipt R1`, cmd.why(U, { receipt: "R1" })],
  workflow: [`norn workflow ${S} <name>`, cmd.workflow(S), `norn workflow ${U} fix --to <a|b>`, cmd.workflow(U, "fix", { to: "<a|b>" })],
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
});
