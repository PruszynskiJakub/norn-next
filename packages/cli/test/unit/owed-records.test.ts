/**
 * Owed base-branch done records over a fake GitPort and a temp machine dir: only the base
 * refusing counts toward the bound after which norn stops retrying, and a base that already reads
 * done drops the record without a fetch or a push.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GitPort, type PushResult, RECORD_REFUSALS, type StoryFacts } from "@norn/core";
import type { StoryFrontmatter } from "@norn/schema";
import { machineDir, type PendingRecord, readPendingRecords, writePendingRecords, writeStoryFile } from "@norn/store";
import type { ActEnv } from "../../src/runtime/act/env.ts";
import { retryRecords } from "../../src/runtime/act/lifecycle.ts";

const T0 = Date.parse("2026-10-23T10:00:00.000Z");
const MIN = 60_000;
const SPEC_DIR = ".agents/specs/gh-7-login";
const FM: StoryFrontmatter = {
  id: "gh-7",
  slug: "login",
  provider: "gh",
  number: 7,
  url: "https://github.com/o/r/issues/7",
  title: "Login",
  assignee: "jakub",
  workflow: "story",
  status: "active",
  intake_at: new Date(T0).toISOString(),
};

interface Fake {
  push: PushResult;
  fetchFails: boolean;
  calls: string[];
}

function fakeGit(f: Fake): GitPort {
  const git = {
    fetch: async () => {
      f.calls.push("fetch");
      if (f.fetchFails) throw new Error("offline");
    },
    hasPath: async (_root: string, _ref: string, path: string) => path.endsWith("spec.md"),
    worktreeAddDetached: async (_root: string, wt: string) => {
      mkdirSync(join(wt, SPEC_DIR), { recursive: true });
      writeStoryFile(join(wt, SPEC_DIR, "spec.md"), FM, "body\n");
    },
    commit: async () => "a".repeat(40),
    push: async () => {
      f.calls.push("push");
      return f.push;
    },
    updateRef: async () => undefined,
    worktreeRemove: async () => undefined,
    worktreePrune: async () => undefined,
  };
  return git as unknown as GitPort;
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function setup(push: PushResult, opts: { fetchFails?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "norn-owed-"));
  roots.push(root);
  mkdirSync(machineDir(root), { recursive: true });
  const f: Fake = { push, fetchFails: !!opts.fetchFails, calls: [] };
  let now = T0;
  const stories: StoryFacts[] = [];
  const act = {
    root,
    tick: "01JAAAAAAAAAAAAAAAAAAAAAAA",
    git: fakeGit(f),
    config: { sync_interval: "5m" },
    ctx: { clock: { now: () => now } },
    obs: { remote: "origin", facts: { repo: { default_branch: "main" }, stories } },
  } as unknown as ActEnv;
  const owe: PendingRecord = { story: "gh-7", spec_dir: SPEC_DIR, status: "done", attempted_at: T0 - 10 * MIN, attempts: 1, reason: "not on base yet" };
  writePendingRecords(root, [owe]);
  return {
    f,
    act,
    stories,
    step: (ms = 5 * MIN) => {
      now += ms;
    },
    records: () => readPendingRecords(root),
  };
}

describe("owed base records", () => {
  test("a base that keeps refusing stops the retries after RECORD_REFUSALS", async () => {
    const s = setup({ ok: false, reason: "rejected", message: "protected branch" });
    const lines = [];
    for (let i = 0; i < RECORD_REFUSALS; i++) {
      lines.push(await retryRecords(s.act));
      s.step();
    }
    expect(lines.map((l) => l[0]?.stopped)).toEqual([undefined, undefined, true]);
    expect(s.records()).toMatchObject([{ story: "gh-7", refusals: RECORD_REFUSALS, attempts: 1 + RECORD_REFUSALS, stopped_at: T0 + (RECORD_REFUSALS - 1) * 5 * MIN }]);
    expect(lines[0]?.[0]?.reason).toContain("on main by hand (a PR if the branch is protected)");
    const pushes = s.f.calls.filter((c) => c === "push").length;
    s.step(60 * MIN);
    expect(await retryRecords(s.act)).toEqual([]);
    expect(s.f.calls.filter((c) => c === "push").length).toBe(pushes);
  });

  test("an unreachable remote or a network push never counts toward the bound", async () => {
    const offline = setup({ ok: false, reason: "network", message: "x" }, { fetchFails: true });
    for (let i = 0; i < RECORD_REFUSALS + 2; i++) {
      await retryRecords(offline.act);
      offline.step();
    }
    const [r] = offline.records();
    expect(r?.attempts).toBe(1 + RECORD_REFUSALS + 2);
    expect(r && "refusals" in r).toBe(false);
    expect(r && "stopped_at" in r).toBe(false);

    const network = setup({ ok: false, reason: "network", message: "x" });
    for (let i = 0; i < RECORD_REFUSALS + 1; i++) {
      await retryRecords(network.act);
      network.step();
    }
    expect(network.records()[0]).not.toHaveProperty("stopped_at");
  });

  test("a stopped record clears once the base reads done, with no fetch and no push", async () => {
    const s = setup({ ok: false, reason: "auth", message: "denied" });
    for (let i = 0; i < RECORD_REFUSALS; i++) {
      await retryRecords(s.act);
      s.step();
    }
    expect(s.records()[0]?.stopped_at).toBeDefined();
    const calls = s.f.calls.length;
    s.stories.push({ key: "gh-7", base_status: "done", frontmatter: FM } as unknown as StoryFacts);
    expect(await retryRecords(s.act)).toEqual([{ story: "gh-7", state: "unchanged" }]);
    expect(s.records()).toEqual([]);
    expect(s.f.calls.length).toBe(calls);
  });

  test("a live record whose base reads done drops before the throttle", async () => {
    const s = setup({ ok: true });
    writePendingRecords(s.act.root, [{ story: "gh-7", spec_dir: SPEC_DIR, status: "done", attempted_at: T0, attempts: 1, reason: "x" }]);
    s.stories.push({ key: "gh-7", base_status: "done", frontmatter: FM } as unknown as StoryFacts);
    expect(await retryRecords(s.act)).toEqual([{ story: "gh-7", state: "unchanged" }]);
    expect(s.f.calls).toEqual([]);
  });
});
