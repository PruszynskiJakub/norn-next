/**
 * gh-64 at the CLI seam, over ticks: a story's mode nearest first, `agent` picking
 * the coding agent with no entry, the team's `workflow` key with a label still winning,
 * `.env.norn` holding only the slot, the recorded tick interval and the claim timing derived
 * from it, and a slice that still has criteria `needs` under Unblock.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ConfigEntry, ExitCode } from "@norn/schema";
import { readTrace, repoConfigPath, workflowsDir } from "@norn/store";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

type Item = { id: string; story: string; slice: string | null; title: string; command: string };

describe("mode, agent and workflow over ticks (B10, B13, B24, B25, B33)", () => {
  let h: Harness;
  const wt = (key: string, slug: string) => `${h.root}-worktrees/${key}-${slug}`;
  const ticks = async (n: number) => {
    for (let i = 0; i < n; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
  };
  beforeAll(async () => {
    h = await createHarness();
    h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
    // A workflow's own mode
    h.write(join(workflowsDir(h.root), "careful.yaml"), `mode: manual\n${SOLO.replace("name: solo", "name: careful")}`);
    // A step naming a built-in agent that has no entry and is not `agent`
    h.write(join(workflowsDir(h.root), "gem.yaml"), SOLO.replace("name: solo", "name: gem").replace("skill: norn-implement", "skill: norn-implement\n    agent: gemini"));
    // The team's entry workflow; B10, B13: my mode and agent, no agents entry
    h.config("workflow: solo\nmode: auto\nagent: codex\n");
    // A team file with no version is an older norn's repo to init: this one was set up with this norn
    h.recordVersion();
    // Init sets up the agents in use, so it runs once the workflows name them
    expect((await h.norn("init")).exit).toBe(0);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(1, "One"), issue(2, "Two", ["norn", "norn:wf:careful"]), issue(3, "Three", ["norn", "norn:wf:gem"])];
    await ticks(4);
  });
  afterAll(() => h.cleanup());

  test("B24: an issue without a norn:wf: label is taken in on the team's workflow; a labelled one on its own", async () => {
    expect(await h.listed("gh-1")).toMatchObject({ workflow: "solo" });
    expect(await h.listed("gh-2")).toMatchObject({ workflow: "careful" });
  });

  test("B10, B13: my mode auto starts gh-1 with the agent I named; the workflow's mode manual holds gh-2", () => {
    expect(h.runner.launches.find((l) => l.title === "gh-1 implement")?.argv.join(" ")).toContain("codex");
    expect(h.runner.launches.some((l) => l.title === "gh-2 implement")).toBe(false);
  });

  test("B13: a step naming gemini, with no agents entry, launches Gemini", () => {
    expect(h.runner.launches.find((l) => l.title === "gh-3 implement")?.argv.join(" ")).toContain("gemini");
  });

  test("B10: the story's own mode beats the workflow's", async () => {
    expect((await h.norn("story", "edit", "gh-2", "--auto")).exit).toBe(0);
    await ticks(2);
    expect(h.runner.launches.map((l) => l.title)).toContain("gh-2 implement");
  });

  test("B33: .env.norn holds only NORN_SLOT and PORT_BASE, slot n from port 4000 + 10·n", () => {
    const env = readFileSync(join(wt("gh-1", "one"), ".env.norn"), "utf8");
    const keys = env
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("=")[0]);
    expect(keys).toEqual(["NORN_SLOT", "PORT_BASE"]);
    const slot = Number(/NORN_SLOT="?(\d+)/.exec(env)?.[1]);
    expect(env).toMatch(new RegExp(`PORT_BASE="?${4000 + 10 * slot}`));
  });

  test("B38: a slice that still has criteria needs shows under Unblock with the file to fix, not as corrupt", async () => {
    h.write(
      join(wt("gh-1", "one"), ".agents/specs/gh-1-one/slices/02-two.md"),
      "---\nid: gh-1/02\ntitle: Two\ndepends_on: []\nstatus: planned\ncriteria:\n  - { id: c1, verifier: agent, needs: [browser] }\n---\n",
    );
    const items = ((await h.norn("status", "--json")).value as { groups: { unblock: Item[] } }).groups.unblock;
    expect(items).toContainEqual(expect.objectContaining({ slice: "gh-1/02", title: "slice `gh-1/02`: `needs` was removed; delete it from the criteria in .agents/specs/gh-1-one/slices/02-two.md", command: "norn run view gh-1/02 --why" }));
    expect(items.some((i) => i.title.startsWith("corrupt"))).toBe(false);
  });
});

describe("the agent command a launch runs (B14, B15)", () => {
  let h: Harness;
  const argvOf = (title: string) => h.runner.launches.find((l) => l.title === title)?.argv ?? [];
  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
    h.config("workflow: solo\nmode: auto\nagents: { claude: { model: claude-opus-5-5 } }\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(1, "One")];
    for (let i = 0; i < 4; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    // An empty args list replaces the built-in one whole
    h.config("workflow: solo\nmode: auto\nagents: { claude: { args: [] } }\n");
    h.remote.issues = [issue(1, "One"), issue(2, "Two")];
    h.clock.advance(6 * 60_000); // past the next sync
    for (let i = 0; i < 4; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
  });
  afterAll(() => h.cleanup());

  test("B14: setting a model keeps the built-in --permission-mode auto, and the model is passed", () => {
    const argv = argvOf("gh-1 implement").join(" ");
    expect(argv).toContain("--permission-mode auto");
    expect(argv).toContain("claude-opus-5-5");
  });

  test("B15: args: [] launches claude with no permission mode", () => {
    const argv = argvOf("gh-2 implement");
    expect(argv.join(" ")).toContain("claude");
    expect(argv).not.toContain("--permission-mode");
  });
});

describe("a notification that fails to send (B47)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.notifier.notify = async () => {
      throw new Error("notify ntfy: fetch failed");
    };
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(1, "One")];
    for (let i = 0; i < 3; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    // past the attended wait: the ready step is notified
    h.clock.advance(3 * 60_000);
    await h.tick();
  });
  afterAll(() => h.cleanup());

  // the error naming its file is wiring's (S3, wiring.test.ts); here the tick goes on and traces it
  test("B47: the tick goes on and the trace keeps the send error", async () => {
    const rejects = readTrace(h.root, { types: ["reject"] }).events as Array<{ source: string; reason: string }>;
    expect(rejects.filter((e) => e.source === "notify").map((e) => e.reason)).toContain("notify ntfy: fetch failed");
  });
});

describe("the tick interval and claim timing (B34, B35)", () => {
  let h: Harness;
  const get = async (key: string) => ((await h.norn("config", "get", key, "--json")).value as { entries: ConfigEntry[] }).entries;
  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
  });
  afterAll(() => h.cleanup());

  test("B34: no recorded interval → 30s built in; claim lease 10m renewed every 3m20s (B35)", async () => {
    expect(await get("interval")).toMatchObject([{ value: "30s", source: "built-in" }]);
    expect(await get("claim")).toMatchObject([
      { key: "claim.lease", value: "10m", source: "derived" },
      { key: "claim.renew", value: "3m20s", source: "derived" },
    ]);
  });

  test("B34: norn tick --interval records it; a plain tick keeps it; the claim follows (B35)", async () => {
    await h.tick("--interval", "5m");
    await h.tick();
    expect(await get("interval")).toMatchObject([{ value: "5m", source: "derived" }]);
    expect(await get("claim")).toMatchObject([
      { key: "claim.lease", value: "20m", reason: "interval 5m" },
      { key: "claim.renew", value: "6m40s" },
    ]);
  });

  test("B34: ticks every 2 minutes with --interval 2m keep the heartbeat up: no norn watch item", async () => {
    await h.tick("--interval", "2m");
    h.clock.advance(2 * 60_000);
    await h.tick("--interval", "2m");
    h.clock.advance(2 * 60_000);
    const unblock = ((await h.norn("status", "--json")).value as { groups: { unblock: Item[] } }).groups.unblock;
    expect(unblock.filter((i) => i.command === "norn watch")).toEqual([]);
  });

  test("a bad --interval is a usage error", async () => {
    expect((await h.norn("tick", "--interval", "soon", "--json")).exit).toBe(2);
  });
});

describe("norn init sets up the agents in use only (B13)", () => {
  const AGENT_DIRS = [".claude", ".codex", ".gemini", ".opencode"];
  const present = (h: Harness) => AGENT_DIRS.filter((d) => existsSync(join(h.root, d)));

  test("B1: a plain init installs hooks and skills for Claude only", async () => {
    const h = await createHarness();
    try {
      const r = await h.norn("init", "--json");
      expect(r.exit).toBe(0);
      expect(present(h)).toEqual([".claude"]);
      expect((r.value as { hooks: Array<{ agent: string }> }).hooks.map((x) => x.agent)).toEqual(["claude"]);
    } finally {
      h.cleanup();
    }
  });

  test("B13: an agent in use — the default agent or one a workflow step names — is set up too", async () => {
    const h = await createHarness();
    try {
      h.write(join(h.root, ".agents", "norn.config.local.yaml"), "agent: codex\n");
      h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO.replace("type: agent\n", "type: agent\n    agent: gemini\n"));
      expect((await h.norn("init")).exit).toBe(0);
      expect(present(h)).toEqual([".codex", ".gemini"]);
    } finally {
      h.cleanup();
    }
  });

  test("B1, B7: an old key in the user file refuses init before it writes anything", async () => {
    const h = await createHarness();
    try {
      h.write(join(h.home, "config.yaml"), "default_mode: auto\n");
      const r = await h.norn("init", "--json");
      expect(r).toMatchObject({ exit: ExitCode.config, value: { code: "config_moved" } });
      expect(present(h)).toEqual([]);
      expect(existsSync(repoConfigPath(h.root))).toBe(false);
      expect(existsSync(workflowsDir(h.root))).toBe(false);
    } finally {
      h.cleanup();
    }
  });
});
