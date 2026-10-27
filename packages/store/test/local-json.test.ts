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
  readHeartbeatFile,
  readLocalJson,
  readPrFacts,
  readTrace,
  traceDir,
} from "../src/index.ts";
import { tmp } from "./helpers.ts";

function repo(): string {
  const r = tmp();
  mkdirSync(traceDir(r), { recursive: true });
  return r;
}
const put = (r: string, name: string, v: unknown) => writeFileSync(join(traceDir(r), name), typeof v === "string" ? v : JSON.stringify(v));
const localEvents = (r: string) => readTrace(r, { types: ["local_file"] }).events;

describe("readLocalJson (S2, BUG-4)", () => {
  test("a valid file reads as itself; a missing one as the fallback, untraced", () => {
    const r = repo();
    put(r, "remote.json", { synced_at: 1, attempted_at: 2, last_error: null, default_branch: "main" });
    expect(readLocalJson("local-remote", join(traceDir(r), "remote.json"), {}, r)).toEqual({ synced_at: 1, attempted_at: 2, last_error: null, default_branch: "main" });
    expect(readLocalJson("local-notified", join(traceDir(r), "notified.json"), { ids: ["x"] }, r)).toEqual({ ids: ["x"] });
    expect(localEvents(r)).toEqual([]);
  });

  test("wrong shape and invalid JSON read as the fallback and leave one local_file event each", () => {
    const r = repo();
    put(r, "remote.json", { attempted_at: "soon" });
    put(r, "notified.json", "{not json");
    const remote = join(traceDir(r), "remote.json");
    expect(readLocalJson("local-remote", remote, {}, r)).toEqual({});
    expect(readLocalJson("local-remote", remote, {}, r)).toEqual({}); // traced once per content
    expect(readLocalJson("local-notified", join(traceDir(r), "notified.json"), {}, r)).toEqual({});
    const evs = localEvents(r) as Array<{ file: string; schema: string; reason: string }>;
    expect(evs.map((e) => [e.file, e.schema, e.reason])).toEqual([
      [".agents/norn/trace/remote.json", "local-remote", "wrong_shape"],
      [".agents/norn/trace/notified.json", "local-notified", "invalid_json"],
    ]);
  });

  test("unknown properties are kept (a newer norn's file still reads)", () => {
    const r = repo();
    put(r, "cockpit.json", { notes_seen_at: "2026-10-23T12:00:00.000Z", later: 1 });
    expect(readCockpitFile(r).notes_seen_at).toBe("2026-10-23T12:00:00.000Z");
  });

  test("store readers: wrong-shaped heartbeat, failures, cockpit, base, pr and remote read as empty", () => {
    const r = repo();
    put(r, "heartbeat.json", { heartbeat_id: 7 });
    put(r, "failures.json", { units: { "gh-1": { effect: "nudge" } } });
    put(r, "cockpit.json", ["junk"]);
    put(r, "base.json", { stories: { "gh-1": { ref: "x", behind: "many" } } });
    put(r, "pr.json", { stories: { "gh-1": { pr: { number: "1" }, observed_at: 1 } } });
    put(r, "remote.json", { default_branch: 3 });
    expect(readHeartbeatFile(r)).toEqual({});
    expect(readActFailures(r)).toEqual({});
    expect(readCockpitFile(r)).toEqual({});
    expect(readBaseFacts(r)).toEqual({});
    expect(readPrFacts(r)).toEqual({});
    expect(cachedDefaultBranch(r)).toBeNull();
    expect(localEvents(r)).toHaveLength(6);
  });

  test("a lock of the wrong shape is reclaimed as unreadable", async () => {
    const r = repo();
    const path = join(traceDir(r), "tick.lock");
    put(r, "tick.lock", { holder: { pid: "1", pid_start: "x" }, acquired_at: "now" });
    const l = await acquireLock(path, { self: { pid: process.pid, pid_start: "me" }, liveness: async () => true });
    expect(l.ok).toBe(true);
    if (l.ok) expect(l.reclaimed?.holder.pid_start).toBe("unreadable");
  });
});
