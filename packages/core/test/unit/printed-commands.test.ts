import { describe, expect, test } from "bun:test";
import { cmd, nameRemoved, upgradeBackward, versionBaseline, versionMismatch } from "@norn/core";

// Every command norn prints is built by one `cmd` builder. This table pins each builder's
// string for a sample unit, so renaming a command is one reviewed diff of this table and the module.
// None of them names a removed command.
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
  upgrade: ["norn upgrade", cmd.upgrade()],
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
  storyWait: [`norn story wait ${S} --until gate`, cmd.storyWait(S, "gate"), `norn story wait ${U} --until step=review --timeout 30m`, cmd.storyWait(U, "step=review", { timeout: "30m" })],
  stuck: [`norn stuck "<reason>"`, cmd.stuck(), `norn stuck "<why>"`, cmd.stuck("<why>")],
  storyTake: [`norn story take ${S}`, cmd.storyTake(S)],
  storyCheckout: [`norn story checkout ${S}`, cmd.storyCheckout(S), `norn story checkout ${S} --force`, cmd.storyCheckout(S, { force: true })],
  storyClose: [`norn story close ${S}`, cmd.storyClose(S), `norn story close ${S} --yes`, cmd.storyClose(S, { yes: true }), "norn story close", cmd.storyClose()],
  storyHandoff: [`norn story handoff ${S}`, cmd.storyHandoff(S), "norn story handoff", cmd.storyHandoff()],
  storyReopen: [`norn story reopen ${S}`, cmd.storyReopen(S), "norn story reopen", cmd.storyReopen()],
  storyReset: [`norn story reset ${S}`, cmd.storyReset(S), `norn story reset ${S} --yes --force`, cmd.storyReset(S, { yes: true, force: true }), "norn story reset", cmd.storyReset()],
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

describe("printed commands", () => {
  test("the table covers every builder the module exports", () => {
    expect(Object.keys(today).sort()).toEqual(Object.keys(cmd).sort());
  });
  for (const [name, pairs] of Object.entries(today)) {
    test(`${name} prints today's string`, () => {
      for (let i = 0; i < pairs.length; i += 2) expect(pairs[i + 1]).toBe(pairs[i]);
    });
  }
  test("no builder prints a removed command", () => {
    for (const [name, pairs] of Object.entries(today)) for (const printed of pairs) expect({ name, removed: nameRemoved(printed) }).toEqual({ name, removed: null });
  });
  test("the removed-command check catches each old verb, and not its new spelling", () => {
    for (const old of ["drop gh-1", "inbox", "cockpit --next", "orient --open", "open gh-1", `answer gh-1 "x"`, "approve gh-1", "unstick gh-1 --to qa", "update gh-1", "mode auto", "workflow gh-1 fix", "take gh-1", "release gh-1", "trace gh-1", "why gh-1"])
      expect(nameRemoved(`run \`norn ${old}\` now`)).toBe(`norn ${old.split(" ")[0]}`);
    for (const ok of ["norn story update-branch gh-1", "norn done approve", "norn story approve gh-1", "norn status --watch", ".agents/norn/trace/x"]) expect(nameRemoved(ok)).toBeNull();
  });
});

describe("the version refusal (D3)", () => {
  test("an older binary is told which norn to install", () => {
    expect(versionMismatch("0.19.0", "0.18.1")).toEqual({ match: "older", needs: "0.19.x", error: "this repo needs norn 0.19.x (you run 0.18.1)", do_instead: "install norn 0.19.x" });
    expect(versionMismatch("0.18.2", "0.18.1")).toEqual({ match: "older", needs: "0.18.2 or a later 0.18.x", error: "this repo needs norn 0.18.2 or a later 0.18.x (you run 0.18.1)", do_instead: "install norn 0.18.2 or a later 0.18.x" });
    expect(versionMismatch("1.2.0", "1.1.9")?.do_instead).toBe("install norn 1.2.0 or a later 1.x");
    expect(versionMismatch("2.0.0", "1.5.0")?.do_instead).toBe("install norn 2.x");
  });

  test("a newer binary is told to run norn upgrade and commit, or to install the repo's norn", () => {
    expect(versionMismatch("0.18.0", "0.19.0")).toEqual({
      match: "newer",
      needs: "0.18.x",
      error: "this repo needs norn 0.18.x (you run 0.19.0)",
      do_instead: "run `norn upgrade` to move this repo to norn 0.19.0 and commit the change, or install norn 0.18.x",
    });
  });

  test("norn upgrade run by an older binary is told it will not move the repo back, and which norn to install (B17)", () => {
    expect(upgradeBackward("0.19.0", "0.18.1")).toEqual({ error: "this repo is set up for norn 0.19.0; upgrade will not move it back", do_instead: "install norn 0.19.x" });
  });
});

describe("the 0.30 baseline", () => {
  const PATH = "install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.31.2";

  test("a repo recording a version below 0.30 is refused with the 0.30 path", () => {
    expect(versionBaseline("0.29.4", "0.31.2")).toEqual({
      code: "version_too_old",
      error: "this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on",
      needs: "0.30.x",
      do_instead: PATH,
    });
  });

  test("a repo recording no version is refused, naming norn init and the 0.30 path", () => {
    expect(versionBaseline(null, "0.31.2")).toEqual({
      code: "version_missing",
      error: "this repo records no norn_version",
      needs: "0.30.x",
      do_instead: `run \`norn init\` if norn was never set up here; for a repo from an older norn, ${PATH}`,
    });
  });

  test("a repo recording 0.30.0 or later gets nothing from it and goes on to the mismatch rule", () => {
    for (const repo of ["0.30.0", "0.30.5", "0.31.0", "1.0.0"]) expect(versionBaseline(repo, "0.31.2")).toBeNull();
    expect(versionMismatch("0.30.0", "0.31.2")?.match).toBe("newer");
  });
});
