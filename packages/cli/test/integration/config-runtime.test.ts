/**
 * gh-64 at the CLI seam (S1), over ticks: a story's mode nearest first (B10, B25), `agent` picking
 * the coding agent with no entry (B13), the team's `workflow` key with a label still winning (B24),
 * `.env.norn` holding only the slot (B33), the recorded tick interval and the claim timing derived
 * from it (B34, B35), and a slice that still has criteria `needs` under Unblock (B38).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigEntry } from "@norn/schema";
import { workflowsDir } from "@norn/store";
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
    expect((await h.norn("init")).exit).toBe(0);
    h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
    // B25: a workflow's own mode
    h.write(join(workflowsDir(h.root), "careful.yaml"), `mode: manual\n${SOLO.replace("name: solo", "name: careful")}`);
    // B24: the team's entry workflow; B10, B13: my mode and agent, no agents entry
    h.config("workflow: solo\nmode: auto\nagent: codex\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(1, "One"), issue(2, "Two", ["norn", "norn:wf:careful"])];
    await ticks(4);
  });
  afterAll(() => h.cleanup());

  test("B24: an issue without a norn:wf: label is taken in on the team's workflow; a labelled one on its own", async () => {
    expect(await h.listed("gh-1")).toMatchObject({ workflow: "solo" });
    expect(await h.listed("gh-2")).toMatchObject({ workflow: "careful" });
  });

  test("B10, B13: my mode auto starts gh-1 with the agent I named; the workflow's mode manual holds gh-2", () => {
    expect(h.runner.launches.map((l) => l.title)).toEqual(["gh-1 implement"]);
    expect(h.runner.launches[0]?.argv.join(" ")).toContain("codex");
  });

  test("B10: the story's own mode beats the workflow's", async () => {
    expect((await h.norn("story", "edit", "gh-2", "--auto")).exit).toBe(0);
    await ticks(2);
    expect(h.runner.launches.map((l) => l.title)).toEqual(["gh-1 implement", "gh-2 implement"]);
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

  test("B38: a slice that still has criteria needs shows under Unblock with norn migrate, not as corrupt", async () => {
    h.write(
      join(wt("gh-1", "one"), ".agents/specs/gh-1-one/slices/02-two.md"),
      "---\nid: gh-1/02\ntitle: Two\ndepends_on: []\nstatus: planned\ncriteria:\n  - { id: c1, verifier: agent, needs: [browser] }\n---\n",
    );
    const items = ((await h.norn("status", "--json")).value as { groups: { unblock: Item[] } }).groups.unblock;
    expect(items).toContainEqual(expect.objectContaining({ slice: "gh-1/02", title: "slice `gh-1/02`: `needs` was removed; run `norn migrate`", command: "norn migrate" }));
    expect(items.some((i) => i.title.startsWith("corrupt"))).toBe(false);
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
