/**
 * A repo whose main checkout records no `norn_version`, or one below 0.30, is refused by every command
 * that acts (exit 3, `version_missing` / `version_too_old`, the baseline rule's text) before it writes,
 * launches or pushes anything; `watch` pauses on it; setup, help and diagnosis still run; `norn status`
 * shows it as an Unblock item pointing to `norn doctor`. Driven through `runCli` with the harness.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { versionBaseline } from "@norn/core";
import { localConfigPath, REPO_CONFIG_FILE, repoConfigPath, workflowsDir } from "@norn/store";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

const RUNNING = "0.31.0";
const WORKFLOW = `name: ship
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

/** set (or, with null, remove) `norn_version` in the main checkout's team file, as a pull or a hand edit would */
function setVersion(h: Harness, v: string | null): void {
  const file = repoConfigPath(h.root);
  const kept = readFileSync(file, "utf8").replace(/^norn_version:.*\n?/m, "");
  writeFileSync(file, v === null ? kept : `${kept}norn_version: ${v}\n`);
}

async function setUp(h: Harness): Promise<void> {
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: ship\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "ship.yaml"), WORKFLOW);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(3, "Add totals")];
}

/** the rule's refusal as the cli prints it with `--json` */
const refusalOf = (repo: string | null) => {
  const rule = versionBaseline(repo, RUNNING)!;
  return { error: rule.error, do_instead: rule.do_instead, code: rule.code, details: { repo, running: RUNNING } };
};

const ACTING: Record<string, string[]> = {
  tick: ["tick"],
  watch: ["watch", "--max-ticks", "1"],
  sync: ["sync"],
  brief: ["brief"],
  tidy: ["tidy"],
  "config set": ["config", "set", "mode", "auto", "--local"],
  "config unset": ["config", "unset", "mode", "--local"],
  "story start": ["story", "start", "gh-3"],
  "story approve": ["story", "approve", "gh-3"],
  "story reject": ["story", "reject", "gh-3", "--reason", "no"],
  "story answer": ["story", "answer", "gh-3", "yes"],
  "story edit": ["story", "edit", "gh-3", "--auto"],
  "story take": ["story", "take", "gh-3"],
  "story create": ["story", "create", "--title", "More"],
  "story close": ["story", "close", "gh-3", "--yes"],
  "story reopen": ["story", "reopen", "gh-3"],
  "story reset": ["story", "reset", "gh-3", "--yes"],
  "story checkout": ["story", "checkout", "gh-3"],
  "story update-branch": ["story", "update-branch", "gh-3"],
  "story chat": ["story", "chat", "gh-3"],
  "story handoff": ["story", "handoff", "gh-3"],
  "run rerun": ["run", "rerun", "gh-3"],
  "run cancel": ["run", "cancel", "gh-3"],
  "run attach": ["run", "attach", "gh-3"],
};

for (const [label, repo, code] of [
  ["below 0.30", "0.29.4", "version_too_old"],
  ["no norn_version", null, "version_missing"],
] as const) {
  describe(`a repo recording ${label} is refused by every command that acts`, () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createHarness({ version: RUNNING });
      await setUp(h);
      setVersion(h, repo);
    });
    afterAll(() => h.cleanup());

    test(`tick and story start exit 3 with ${code} and the rule's text; nothing is written, launched or pushed`, async () => {
      const remoteRefs = h.git(["ls-remote", h.remoteDir]);
      for (const argv of [["tick"], ["story", "start", "gh-3"]]) {
        const r = await h.norn(...argv, "--json");
        expect({ argv, exit: r.exit, value: r.value }).toEqual({ argv, exit: 3, value: refusalOf(repo) });
      }
      expect(existsSync(`${h.root}-worktrees`)).toBe(false);
      expect(h.runner.launches).toEqual([]);
      expect(h.git(["ls-remote", h.remoteDir])).toBe(remoteRefs);
      expect(h.git(["status", "--porcelain"])).toBe(`M ${REPO_CONFIG_FILE}`);
      expect(await h.listed("gh-3")).toBeUndefined();
    });

    test("every acting command gets the same refusal, as JSON and as markdown", async () => {
      const acting = [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)].filter((c) => c.version === "acts").map((c) => c.name);
      expect(Object.keys(ACTING).sort()).toEqual(acting.sort());
      const local = readFileSync(localConfigPath(h.root), "utf8");
      for (const [name, argv] of Object.entries(ACTING)) {
        const r = await h.norn(...argv, "--json");
        expect({ name, exit: r.exit, value: r.value }).toEqual({ name, exit: 3, value: refusalOf(repo) });
      }
      expect(readFileSync(localConfigPath(h.root), "utf8")).toBe(local);
      expect(h.runner.launches).toEqual([]);
      const md = await h.norn("config", "set", "mode", "auto", "--local");
      expect(md.stdout).toStartWith(`**Refused (${code}):** ${refusalOf(repo).error}`);
    });

    test("norn status shows an Unblock item with the rule's text and norn doctor, not a Check item to norn upgrade", async () => {
      const rule = versionBaseline(repo, RUNNING)!;
      const r = await h.norn("status", "--json");
      expect(r.exit).toBe(0);
      const groups = (JSON.parse(r.stdout) as { groups: Record<string, Array<{ title: string; command: string }>> }).groups;
      expect(groups.check ?? []).toEqual([]);
      expect(groups.unblock?.[0]).toMatchObject({ title: `${rule.error}: ${rule.do_instead}`, command: "norn doctor" });
      expect((await h.norn("status")).stdout).toContain(rule.error);
    });

    test("help, doctor, init and upgrade are not stopped by the guard", async () => {
      expect((await h.norn("help")).exit).toBe(0);
      const doctor = await h.norn("doctor", "--json");
      expect(doctor.value).toHaveProperty("repo");
      for (const argv of [["init"], ["upgrade"]]) {
        const r = await h.norn(...argv, "--json");
        expect({ argv, value: r.value }).not.toEqual({ argv, value: refusalOf(repo) });
      }
      for (const c of [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)].filter((c) => ["help", "doctor", "init", "upgrade"].includes(c.name)))
        expect({ name: c.name, version: c.version }).not.toEqual({ name: c.name, version: "acts" });
    });
  });
}

describe("watch pauses its ticks on a repo below the baseline", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ version: RUNNING });
    await setUp(h);
  });
  afterAll(() => h.cleanup());

  test("a tick after the team file loses its version is skipped with the refusal and one notification", async () => {
    const lines: Array<Record<string, unknown>> = [];
    const r = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "3", "--keep-claims"], {
      ...h.deps,
      log: (l) => {
        lines.push(JSON.parse(l));
        if (lines.length === 1) setVersion(h, null);
      },
    });
    expect(r.exit).toBe(0);
    expect(lines[0]).toHaveProperty("tick_id");
    expect(lines.slice(1)).toEqual([{ at: expect.any(String), ...refusalOf(null) }, { at: expect.any(String), ...refusalOf(null) }]);
    expect(h.notifier.items.filter((i) => i.title.endsWith("ticks paused")).map((i) => i.title)).toEqual(["this repo needs norn 0.30.x; ticks paused"]);
  });

  test("a config that fails to load is its own config error (exit 6), not the baseline refusal", async () => {
    setVersion(h, null);
    writeFileSync(repoConfigPath(h.root), `${readFileSync(repoConfigPath(h.root), "utf8")}bogus: 1\n`);
    const r = await h.norn("tick", "--json");
    expect(r.exit).toBe(6);
    expect(r.value).toMatchObject({ code: "config_invalid" });
  });
});
