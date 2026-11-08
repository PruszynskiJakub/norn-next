/** Machine-local files (S2, BUG-4): every read is validated; a bad file reads as empty and is traced once. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireLock,
  cachedDefaultBranch,
  readActFailures,
  readBaseFacts,
  readCockpitFile,
  dropRecords,
  owedRecords,
  readPendingRecords,
  readHeartbeatFile,
  readLocalJson,
  readPrFacts,
  readTrace,
  machineDir,
} from "../../src/index.ts";
import { tmp } from "../helpers.ts";

function repo(): string {
  const r = tmp();
  mkdirSync(machineDir(r), { recursive: true });
  return r;
}
const put = (r: string, name: string, v: unknown) => writeFileSync(join(machineDir(r), name), typeof v === "string" ? v : JSON.stringify(v));
const localEvents = (r: string) => readTrace(r, { types: ["local_file"] }).events;

describe("readLocalJson (BUG-4)", () => {
  test("a valid file reads as itself; a missing one as the fallback, untraced", () => {
    const r = repo();
    put(r, "remote.json", { synced_at: 1, attempted_at: 2, last_error: null, default_branch: "main" });
    expect(readLocalJson("local-remote", join(machineDir(r), "remote.json"), {}, r)).toEqual({ synced_at: 1, attempted_at: 2, last_error: null, default_branch: "main" });
    expect(readLocalJson("local-notified", join(machineDir(r), "notified.json"), { ids: ["x"] }, r)).toEqual({ ids: ["x"] });
    expect(localEvents(r)).toEqual([]);
  });

  test("wrong shape and invalid JSON read as the fallback and leave one local_file event each", () => {
    const r = repo();
    put(r, "remote.json", { attempted_at: "soon" });
    put(r, "notified.json", "{not json");
    const remote = join(machineDir(r), "remote.json");
    expect(readLocalJson("local-remote", remote, {}, r)).toEqual({});
    expect(readLocalJson("local-remote", remote, {}, r)).toEqual({}); // traced once per content
    expect(readLocalJson("local-notified", join(machineDir(r), "notified.json"), {}, r)).toEqual({});
    const evs = localEvents(r) as Array<{ file: string; schema: string; reason: string }>;
    expect(evs.map((e) => [e.file, e.schema, e.reason])).toEqual([
      // Absolute, the file is outside the repo
      [remote, "local-remote", "wrong_shape"],
      [join(machineDir(r), "notified.json"), "local-notified", "invalid_json"],
    ]);
  });

  test("unknown properties are kept (a newer norn's file still reads)", () => {
    const r = repo();
    put(r, "cockpit.json", { last_repo: "/repo", later: 1 });
    expect(readCockpitFile(machineDir(r)).last_repo).toBe("/repo");
  });

  test("the cockpit memory in the norn home: a wrong shape reads as empty, untraced (no repository)", () => {
    const r = repo();
    put(r, "cockpit.json", { last_repo: 7 });
    expect(readCockpitFile(machineDir(r))).toEqual({});
    put(r, "cockpit.json", ["junk"]);
    expect(readCockpitFile(machineDir(r))).toEqual({});
    expect(localEvents(r)).toEqual([]);
  });

  test("store readers: wrong-shaped heartbeat, failures, base, pr and remote read as empty", () => {
    const r = repo();
    put(r, "heartbeat.json", { heartbeat_id: 7 });
    put(r, "failures.json", { units: { "gh-1": { effect: "nudge" } } });
    put(r, "base.json", { stories: { "gh-1": { ref: "x", behind: "many" } } });
    put(r, "pr.json", { stories: { "gh-1": { pr: { number: "1" }, observed_at: 1 } } });
    put(r, "remote.json", { default_branch: 3 });
    expect(readHeartbeatFile(r)).toEqual({});
    expect(readActFailures(r)).toEqual({});
    expect(readBaseFacts(r)).toEqual({});
    expect(readPrFacts(r)).toEqual({});
    expect(cachedDefaultBranch(r)).toBeNull();
    expect(localEvents(r)).toHaveLength(5);
  });

  test("a lock of the wrong shape is reclaimed as unreadable", async () => {
    const r = repo();
    const path = join(machineDir(r), "tick.lock");
    put(r, "tick.lock", { holder: { pid: "1", pid_start: "x" }, acquired_at: "now" });
    const l = await acquireLock(path, { self: { pid: process.pid, pid_start: "me" }, liveness: async () => true });
    expect(l.ok).toBe(true);
    if (l.ok) expect(l.reclaimed?.holder.pid_start).toBe("unreadable");
  });
});

describe("records.json: owed base-branch records", () => {
  const T = Date.parse("2026-10-23T10:00:00.000Z");
  const live = { story: "gh-1", spec_dir: ".agents/specs/gh-1-a", status: "done", attempted_at: T, attempts: 1, reason: "fetch main: offline" };
  const stopped = { story: "gh-2", spec_dir: ".agents/specs/gh-2-b", status: "done", attempted_at: T, attempts: 4, reason: "push to main rejected (rejected)", refusals: 3, stopped_at: T + 1 };

  test("a file written before refusals and stopped_at still reads; a new one reads its fields back", () => {
    const r = repo();
    put(r, "records.json", { records: [live, stopped] });
    expect(readPendingRecords(r)).toEqual([live, stopped] as never);
    expect(localEvents(r)).toEqual([]);
  });

  test("only stopped records are owed facts, their epochs as ISO", () => {
    expect(owedRecords([live, stopped] as never)).toEqual([
      { story: "gh-2", spec_dir: ".agents/specs/gh-2-b", refusals: 3, reason: stopped.reason, attempted_at: new Date(T).toISOString(), stopped_at: new Date(T + 1).toISOString() },
    ]);
  });

  test("dropRecords keeps what keep accepts, and writes nothing when dry", () => {
    const r = repo();
    put(r, "records.json", { records: [live, stopped] });
    expect(dropRecords(r, (x) => x.stopped_at === undefined, true).map((x) => x.story)).toEqual(["gh-2"]);
    expect(readPendingRecords(r)).toHaveLength(2);
    expect(dropRecords(r, (x) => x.stopped_at === undefined, false).map((x) => x.story)).toEqual(["gh-2"]);
    expect(readPendingRecords(r).map((x) => x.story)).toEqual(["gh-1"]);
  });
});
