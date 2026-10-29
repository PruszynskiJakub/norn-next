/**
 * The finished surface (B1–B3, B5, B69): `norn help` prints the tiers Core, Setup, Background and the
 * agent protocol, `help --all` adds what nobody types, `norn story` and `norn run` list their verbs
 * grouped, and every removed name is a plain unknown command that changes nothing.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REMOVED_COMMANDS } from "@norn/core";
import { createHarness, type Harness } from "./harness.ts";

setDefaultTimeout(30_000);

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
});
afterAll(() => h.cleanup());

type Help = { tiers: Array<{ title: string; commands: string[] }>; commands: Array<{ command: string; summary: string; for: string }>; skills: Array<{ skill: string }> };
type NounHelp = { command: string; verbs: Array<{ command: string }>; groups?: Array<{ title: string; verbs: string[] }> };

/** Section titles of `norn help` in print order: a line that starts a block of `  norn …` rows. */
function sections(stdout: string): Array<{ title: string; rows: string[] }> {
  const out: Array<{ title: string; rows: string[] }> = [];
  const lines = stdout.split("\n");
  lines.forEach((l, i) => {
    if (l && !l.startsWith(" ") && lines[i + 1]?.startsWith("  norn ")) {
      const rows: string[] = [];
      for (let j = i + 1; lines[j]?.startsWith("  norn "); j++) rows.push((lines[j] as string).slice(7).split(/ {2,}/)[0] as string);
      out.push({ title: l, rows });
    }
  });
  return out;
}

const CORE = ["status", "story", "run"];
const SETUP = ["init", "doctor", "config", "uninstall"];
const BACKGROUND = ["watch", "sync", "tidy"];
const PROTOCOL = ["brief", "done", "ask", "stuck"];

describe("norn help in tiers (B1)", () => {
  test("Core, Setup, Background, Agent protocol in that order, then the skills; tick and hook absent", async () => {
    const r = await h.norn("help");
    expect(r.exit).toBe(0);
    const s = sections(r.stdout);
    expect(s.map((x) => x.title)).toEqual(["Core", "Setup", "Background", "Agent protocol: the only commands an agent runs"]);
    expect(s.map((x) => x.rows)).toEqual([CORE, SETUP, BACKGROUND, PROTOCOL]);
    expect(r.stdout).toMatch(/\n  norn story +\S.* \(create, list, view, answer, approve, reject, update-branch, start, chat, edit, checkout, handoff, close, reopen\)\n/);
    expect(r.stdout).toMatch(/\n  norn status +\S.+\n  norn story +\S.+\n  norn run +\S.+\n/);
    // the agent preamble and the skills list, as before
    expect(r.stdout).toContain("Agent doing a norn step? Run only `norn brief`");
    expect(r.stdout.indexOf("\nSkills (")).toBeGreaterThan(r.stdout.indexOf("\n  norn stuck "));
    expect(r.stdout).not.toMatch(/\n {2}norn (tick|hook|help) /);
  });

  test("--json gives the same tree as data", async () => {
    const r = await h.norn("help");
    const v = r.value as Help;
    expect(v.tiers.map((t) => [t.title, t.commands])).toEqual(sections(r.stdout).map((x) => [x.title, x.rows]));
    expect(v.commands.map((c) => c.command).sort()).toEqual([...CORE, ...SETUP, ...BACKGROUND, ...PROTOCOL].sort());
    expect(JSON.parse((await h.norn("help", "--json")).stdout)).toEqual(v);
  });
});

describe("noun help (B2)", () => {
  test("norn story and norn help story list the verbs under general, decision, work, team", async () => {
    const r = await h.norn("story");
    expect(r.exit).toBe(0);
    const s = sections(r.stdout);
    expect(s.map((x) => [x.title, x.rows])).toEqual([
      ["General", ["story create", "story list", "story view"]],
      ["Decision", ["story answer", "story approve", "story reject", "story update-branch"]],
      ["Work", ["story start", "story chat", "story edit"]],
      ["Team", ["story checkout", "story handoff", "story close", "story reopen"]],
    ]);
    expect((r.value as NounHelp).groups).toEqual([
      { title: "general", verbs: ["story create", "story list", "story view"] },
      { title: "decision", verbs: ["story answer", "story approve", "story reject", "story update-branch"] },
      { title: "work", verbs: ["story start", "story chat", "story edit"] },
      { title: "team", verbs: ["story checkout", "story handoff", "story close", "story reopen"] },
    ]);
    const help = await h.norn("help", "story");
    expect(help.exit).toBe(0);
    expect(help.stdout).toBe(r.stdout);
  });

  test("norn run lists list, view, attach, rerun, cancel", async () => {
    const r = await h.norn("run");
    expect(r.exit).toBe(0);
    expect((r.value as NounHelp).verbs.map((v) => v.command)).toEqual(["run list", "run view", "run attach", "run rerun", "run cancel"]);
    expect(r.stdout).toMatch(/\n  norn run list +.+\n  norn run view +.+\n  norn run attach +.+\n  norn run rerun +.+\n  norn run cancel +.+\n/);
  });
});

describe("norn help --all (B3)", () => {
  test("everything in help plus tick, hook and status --segment", async () => {
    const plain = (await h.norn("help")).value as Help;
    const r = await h.norn("help", "--all");
    expect(r.exit).toBe(0);
    const rows = sections(r.stdout).flatMap((x) => x.rows);
    for (const c of [...CORE, ...SETUP, ...BACKGROUND, ...PROTOCOL, "tick", "hook", "status --segment"]) expect(rows).toContain(c);
    const all = (r.value as Help).commands.map((c) => c.command);
    expect(all.sort()).toEqual([...plain.commands.map((c) => c.command), "tick", "hook", "status --segment"].sort());
    expect((r.value as Help).tiers.flatMap((t) => t.commands).sort()).toEqual(all.sort());
  });
});

/** Every file under the repo (but .git) and the norn home, with a hash of its content. */
function disk(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (base: string, dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === ".git" && dir === h.root) continue;
      if (statSync(p).isDirectory()) walk(base, p);
      else out[`${base}:${relative(h.dir, p)}`] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk("repo", h.root);
  walk("home", h.home);
  return out;
}

describe("removed names are unknown commands (B5, B69)", () => {
  test("the table of old names covers the B5 list", () => {
    expect<string[]>([...REMOVED_COMMANDS].sort()).toEqual(["drop", "inbox", "cockpit", "orient", "open", "answer", "approve", "unstick", "update", "mode", "workflow", "take", "release", "trace", "why"].sort());
  });

  for (const name of REMOVED_COMMANDS) {
    test(`norn ${name} is a usage error and changes nothing on disk`, async () => {
      const before = disk();
      const refs = h.git(["for-each-ref"]);
      for (const args of [[name], [name, "gh-1"], [name, "--json"]]) {
        const r = await h.norn(...args);
        expect(r.exit).toBe(2);
        expect(r.value).toMatchObject({ error: `Unknown command: ${name}`, code: "unknown_command", do_instead: expect.stringContaining("norn help") });
      }
      expect(disk()).toEqual(before);
      expect(h.git(["for-each-ref"])).toBe(refs);
    });
  }

  test("brief, done, ask, stuck and hook are still commands", async () => {
    for (const name of [...PROTOCOL, "hook"]) {
      const r = await h.norn(name, "--help", "--json");
      expect(r.exit).toBe(0);
      expect(r.value).toMatchObject({ command: name });
      // outside a unit worktree each refuses for its own reason, never as an unknown command
      const run = await h.norn(name);
      expect((run.value as { code?: string }).code).not.toBe("unknown_command");
    }
  });
});
