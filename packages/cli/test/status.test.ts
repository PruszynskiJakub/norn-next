/**
 * `norn status` is the inbox (B9, B10), the story table moved to `norn story list` (B15), a one-time
 * notice per checkout tells an upgrader where it went (B13), `status --segment` is only in
 * `help --all` (B14), and `norn inbox` is gone (B5). The inbox's own behaviour is tested where it
 * was (human, inbox-why, prompts, criteria, …), now through `norn status`.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHarness, type Harness } from "./harness.ts";

setDefaultTimeout(30_000);

const NOTICE = "`norn status` now shows what needs you; the story listing moved to `norn story list`.\n";

let h: Harness;
const noticeFile = () => join(h.root, ".agents/norn/trace/notices.json");

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
});
afterAll(() => h.cleanup());

describe("norn status (B9, B13)", () => {
  test("the first status on a checkout prints the notice on stderr once; stdout is the inbox either way", async () => {
    const first = await h.norn("status");
    expect(first.exit).toBe(0);
    expect(first.stderr).toBe(NOTICE);
    expect(first.stdout).toStartWith("Inbox empty — no stories yet.\n");
    const second = await h.norn("status");
    expect(second.exit).toBe(0);
    expect(second.stderr ?? "").toBe("");
    expect(second.stdout).toBe(first.stdout);
    expect(second.value).toEqual(first.value);
  });

  test("--json prints the same value with or without the notice, and never the notice", async () => {
    rmSync(noticeFile(), { force: true });
    const json = await h.norn("status", "--json");
    expect(json.exit).toBe(0);
    expect(json.stderr ?? "").toBe("");
    expect(JSON.parse(json.stdout)).toEqual((await h.norn("status")).value);
    expect(JSON.parse((await h.norn("status", "--json")).stdout)).toEqual(JSON.parse(json.stdout));
  });

  test("an unreadable notice file shows the notice again rather than failing", async () => {
    h.write(noticeFile(), "{ not json");
    const bad = await h.norn("status");
    expect(bad.exit).toBe(0);
    expect(bad.stderr).toBe(NOTICE);
    rmSync(noticeFile(), { force: true });
    mkdirSync(noticeFile(), { recursive: true }); // neither readable nor writable as a file
    for (let i = 0; i < 2; i++) {
      const r = await h.norn("status");
      expect(r.exit).toBe(0);
      expect(r.stderr).toBe(NOTICE);
    }
    rmSync(noticeFile(), { recursive: true, force: true });
  });

  test("status --segment neither shows nor spends the notice", async () => {
    rmSync(noticeFile(), { force: true });
    const seg = await h.norn("status", "--segment");
    expect(seg.exit).toBe(0);
    expect(seg.stderr ?? "").toBe("");
    expect((await h.norn("status")).stderr).toBe(NOTICE);
  });

  test("status takes no story key; that view is the story list now", async () => {
    expect((await h.norn("status", "gh-1")).exit).toBe(2);
  });
});

describe("norn story list (B15, B6)", () => {
  test("prints the story table, --json its data", async () => {
    const r = await h.norn("story", "list");
    expect(r.exit).toBe(0);
    expect(r.stderr ?? "").toBe("");
    expect(JSON.parse((await h.norn("story", "list", "--json")).stdout)).toEqual(r.value);
    expect(r.value).toMatchObject({ stories: [], runs: [], recently_done: [] });
    expect(r.value).not.toHaveProperty("timeline");
  });

  test("norn story lists its verbs", async () => {
    const r = await h.norn("story");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ command: "story", verbs: [{ command: "story list" }, { command: "story view" }, { command: "story chat" }, { command: "story answer" }, { command: "story approve" }, { command: "story reject" }, { command: "story update-branch" }, { command: "story start" }, { command: "story edit" }, { command: "story checkout" }, { command: "story handoff" }, { command: "story close" }] });
  });
});

describe("help and removed names (B5, B14)", () => {
  test("norn inbox, with any flags, is an unknown command and writes nothing", async () => {
    const before = h.git(["status", "--porcelain", "--untracked-files=all", "--ignored"]);
    for (const args of [[], ["--details"], ["--history", "--since", "1d"], ["--json"]]) {
      const r = await h.norn("inbox", ...args);
      expect(r.exit).toBe(2);
      expect(r.value).toMatchObject({ error: "Unknown command: inbox", code: "unknown_command", do_instead: expect.stringContaining("norn help") });
    }
    expect(h.git(["status", "--porcelain", "--untracked-files=all", "--ignored"])).toBe(before);
  });

  test("status --segment is absent from help and listed by help --all", async () => {
    const help = await h.norn("help");
    expect(help.stdout).toMatch(/\n  norn status +/);
    expect(help.stdout).not.toContain("--segment");
    expect((help.value as { commands: Array<{ command: string }> }).commands.map((c) => c.command)).not.toContain("status --segment");
    const all = await h.norn("help", "--all");
    expect(all.stdout).toMatch(/\n  norn status --segment +/);
    expect((all.value as { commands: Array<{ command: string }> }).commands.map((c) => c.command)).toContain("status --segment");
    expect(help.stdout).toMatch(/\n  norn story +.*\(list, view, chat, answer, approve, reject, update-branch, start, edit, checkout, handoff, close\)\n/);
    expect(help.stdout).not.toMatch(/\n  norn inbox /);
  });
});
