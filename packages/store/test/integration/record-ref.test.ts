/**
 * gh-195/08 D2, D3: pack and unpack a story's record against real git. The pack is byte-faithful
 * whatever the repository's conversion config (review F1); unpack never writes outside its folder
 * (F2), replaces the destination instead of merging into it (F3), and validates every JSON file (F6).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { recordRef } from "@norn/schema";
import { pushRecord, readRecordRef, recordTreeId, storyRunStateDir, unpackRecord } from "../../src/index.ts";
import { gitOk } from "../../src/git.ts";
import { tmp } from "../helpers.ts";

const STORY = { key: "gh-9", spec_dir: ".agents/specs/gh-9-x" };
const AT = "2026-01-01T00:00:00Z";

async function repo(config: string[][] = []) {
  const root = join(tmp(), "repo");
  await gitOk(dirname(root), ["init", "-q", root]);
  for (const [k, v] of config) await gitOk(root, ["config", k as string, v as string]);
  return root;
}
const git = async (cwd: string, args: string[], input?: string) => (await gitOk(cwd, args, input)).trim();
function write(base: string, files: Record<string, string>) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(base, p)), { recursive: true });
    writeFileSync(join(base, p), text);
  }
}
function filesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : out.push(relative(dir, join(d, e.name)));
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}
/** a deterministic pseudo-random sequence (a property check that reruns the same cases) */
function rng(seed: number) {
  let s = seed;
  return (n: number) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % n;
  };
}

describe("pack (D2)", () => {
  test("F1: the packed tree is the folder byte for byte and equals recordTreeId, under autocrlf and a clean filter", async () => {
    const names = ["a", "a-b", "a.b", "a0", "b", "ab", "Z", "ż", "日本", "x y", "_story", "rounds", "01-trio", "a~"];
    for (let seed = 1; seed <= 25; seed++) {
      const root = await repo([
        ["core.autocrlf", "input"],
        ["filter.strip.clean", "tr -d x"],
      ]);
      writeFileSync(join(root, ".git", "info", "attributes"), "* filter=strip text=auto\n");
      const story = { ...STORY, key: `gh-${seed}` };
      const base = storyRunStateDir(root, story);
      const rnd = rng(seed);
      const files: Record<string, string> = {};
      const make = (dir: string, depth: number) => {
        for (let i = 0, k = 1 + rnd(4); i < k; i++) {
          const nm = names[rnd(names.length)] as string;
          const p = dir ? `${dir}/${nm}` : nm;
          if (Object.keys(files).some((f) => f === p || f.startsWith(`${p}/`) || p.startsWith(`${f}/`))) continue;
          if (depth < 3 && rnd(3) === 0) make(p, depth + 1);
          else files[p] = [`x${rnd(1000)}\r\n`, "", "plain\n", "x\r\ny\r\n"][rnd(4)] as string;
        }
      };
      make("", 0);
      if (!Object.keys(files).length) files.f = "x\r\n";
      write(base, files);
      const r = await pushRecord(root, null, story, { expected: null, holder: "me@host", branch_commit: null, at: AT });
      expect(r).toMatchObject({ ok: true, pushed: true });
      const ref = await readRecordRef(root, story.key);
      expect(recordTreeId(root, story)).toBe(ref?.tree as string);
      for (const [p, text] of Object.entries(files)) expect(await gitOk(root, ["cat-file", "blob", `${ref?.sha}:${p}`])).toBe(text);
      // nothing changed: nothing pushed
      expect(await pushRecord(root, null, story, { expected: ref?.sha as string, holder: "me@host", branch_commit: null, at: AT })).toMatchObject({ ok: true, pushed: false, reason: "unchanged" });
    }
  });

  test("F7: leftover staging and temp folders are not part of the record", async () => {
    const root = await repo();
    const base = storyRunStateDir(root, STORY);
    write(base, { "_story/state.txt": "s\n", "._story.move-123/x.json": "{}", "_story/.state.json.1.2.3.tmp": "{", ".gh-9.unpack-9/y": "y" });
    const r = await pushRecord(root, null, STORY, { expected: null, holder: "me@host", branch_commit: null, at: AT });
    expect(r.ok).toBe(true);
    const sha = (await readRecordRef(root, STORY.key))?.sha as string;
    expect((await git(root, ["ls-tree", "-r", "--name-only", sha])).split("\n")).toEqual(["_story/state.txt"]);
    expect(recordTreeId(root, STORY)).toBe((await readRecordRef(root, STORY.key))?.tree as string);
  });
});

describe("unpack (D3)", () => {
  async function commitOf(root: string, entries: string): Promise<string> {
    return git(root, ["commit-tree", await git(root, ["mktree"], entries), "-m", "record"]);
  }

  test("F2: a tree entry named .. is refused and nothing is written anywhere", async () => {
    const root = await repo();
    const blob = await git(root, ["hash-object", "-w", "--stdin"], "evil\n");
    const inner = await git(root, ["mktree"], `100644 blob ${blob}\tescaped.txt\n`);
    const sha = await commitOf(root, `040000 tree ${inner}\t..\n100644 blob ${blob}\tok.txt\n`);
    const parent = join(tmp(), "machine", "runs");
    mkdirSync(parent, { recursive: true });
    const dest = join(parent, "gh-9");
    const r = await unpackRecord(root, sha, dest);
    expect(r.ok).toBe(false);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(join(parent, "escaped.txt"))).toBe(false);
    expect(readdirSync(dirname(dirname(parent)), { recursive: true })).toEqual(["machine", "machine/runs"]);
  });

  test("F2: a symlink entry is refused", async () => {
    const root = await repo();
    const target = await git(root, ["hash-object", "-w", "--stdin"], "/etc/passwd");
    const sha = await commitOf(root, `120000 blob ${target}\tlink\n`);
    const dest = join(tmp(), "gh-9");
    expect((await unpackRecord(root, sha, dest)).ok).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  test("F2: a name with a tab or a newline is read whole", async () => {
    const root = await repo();
    const blob = await git(root, ["hash-object", "-w", "--stdin"], "t\n");
    const tree = await git(root, ["mktree", "-z"], `100644 blob ${blob}\ta\tb\nc\0`);
    const sha = await git(root, ["commit-tree", tree, "-m", "record"]);
    const dest = join(tmp(), "gh-9");
    expect(await unpackRecord(root, sha, dest)).toEqual({ ok: true, files: 1 });
    expect(readFileSync(join(dest, "a\tb\nc"), "utf8")).toBe("t\n");
  });

  test("F3: unpacking over an existing folder replaces it; files the record does not hold do not survive", async () => {
    const root = await repo();
    const base = storyRunStateDir(root, STORY);
    write(base, { "_story/notes.txt": "kept\n" });
    expect((await pushRecord(root, null, STORY, { expected: null, holder: "me@host", branch_commit: null, at: AT })).ok).toBe(true);
    const dest = join(tmp(), "gh-9");
    write(dest, { "_story/notes.txt": "old\n", "_story/receipts/0009-done.json": "{}", "01-old/state.txt": "stale\n" });
    expect(await unpackRecord(root, await git(root, ["rev-parse", recordRef(STORY.key)]), dest)).toEqual({ ok: true, files: 1 });
    expect(filesOf(dest)).toEqual(["_story/notes.txt"]);
    expect(readFileSync(join(dest, "_story/notes.txt"), "utf8")).toBe("kept\n");
    expect(readdirSync(dirname(dest)).filter((n) => n !== "gh-9")).toEqual([]);
  });

  test("F6: any JSON file that does not parse fails validation; the old folder stays as it was", async () => {
    const root = await repo();
    const bad = await git(root, ["hash-object", "-w", "--stdin"], "{ nope");
    const inner = await git(root, ["mktree"], `100644 blob ${bad}\tcriteria.json\n`);
    const sha = await commitOf(root, `040000 tree ${inner}\t_story\n`);
    const dest = join(tmp(), "gh-9");
    write(dest, { "_story/notes.txt": "old\n" });
    const r = await unpackRecord(root, sha, dest);
    expect(r.ok).toBe(false);
    expect(filesOf(dest)).toEqual(["_story/notes.txt"]);
  });
});
