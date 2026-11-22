/**
 * Files kept on a ref only norn reads, over real git: the commit holds exactly the files given, chains
 * on the ref's previous commit, moves the ref only when asked, and pushes fast-forward to a remote
 * where it is never a branch.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commit, git, value, world } from "./world.ts";

const REF = "refs/norn/evidence/gh-12";

function onDisk(dir: string, files: Record<string, string | Uint8Array>): string {
  const at = join(dir, "evidence-src");
  mkdirSync(at, { recursive: true });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(at, name), data);
  return at;
}

async function state(repo: string): Promise<string[]> {
  return [await git(repo, "status", "--porcelain", "--untracked-files=all"), await git(repo, "for-each-ref", "refs/heads", "refs/remotes"), await git(repo, "ls-files", "-s"), await git(repo, "rev-parse", "HEAD")];
}

describe("keeping files on a norn-only ref", () => {
  test("keepFiles commits exactly the given files at the tree root, chained on the ref, touching no branch, index or worktree", async () => {
    const w = await world();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    const src = onDisk(w.dir, { "shot.png": png, "log.txt": "ran\n", "ignored.txt": "not kept\n" });
    const before = await state(w.repo);

    const first = value(await w.vcs.keepFiles!(REF, [{ path: "AC1.webp", at: join(src, "shot.png") }, { path: "AC1.txt", at: join(src, "log.txt") }], "evidence gh-12"));
    expect(await git(w.repo, "ls-tree", "--name-only", first.commit)).toBe("AC1.txt\nAC1.webp");
    expect(await git(w.repo, "show", `${first.commit}:AC1.txt`)).toBe("ran");
    expect(await git(w.repo, "rev-parse", `${first.commit}:AC1.webp`)).toBe(await git(w.repo, "hash-object", join(src, "shot.png")));
    expect(await git(w.repo, "rev-list", "--parents", "-n", "1", first.commit)).toBe(first.commit);
    expect(await git(w.repo, "log", "-1", "--format=%s", first.commit)).toBe("evidence gh-12");
    // objects only: the ref is not moved until asked
    expect(value(await w.vcs.head(REF))).toBeNull();
    expect(await state(w.repo)).toEqual(before);

    expect(value(await w.vcs.moveRef!(REF, first.commit))).toEqual({ moved: true });
    expect(value(await w.vcs.moveRef!(REF, first.commit))).toEqual({ moved: false });

    const second = value(await w.vcs.keepFiles!(REF, [{ path: "AC2.txt", at: join(src, "log.txt") }], "evidence gh-12 again"));
    expect(await git(w.repo, "ls-tree", "--name-only", second.commit)).toBe("AC2.txt");
    expect(await git(w.repo, "rev-list", "--parents", "-n", "1", second.commit)).toBe(`${second.commit} ${first.commit}`);
    expect(value(await w.vcs.moveRef!(REF, second.commit))).toEqual({ moved: true });
    expect(value(await w.vcs.head(REF))).toBe(second.commit);
    expect(await state(w.repo)).toEqual(before);
  });

  test("moveRef refuses a commit that does not descend from the ref, so no kept commit is dropped", async () => {
    const w = await world();
    const src = onDisk(w.dir, { "a.txt": "a\n" });
    const a = value(await w.vcs.keepFiles!(REF, [{ path: "a.txt", at: join(src, "a.txt") }], "a"));
    const b = value(await w.vcs.keepFiles!(REF, [{ path: "b.txt", at: join(src, "a.txt") }], "b"));
    value(await w.vcs.moveRef!(REF, a.commit));
    const r = await w.vcs.moveRef!(REF, b.commit);
    expect(r.ok ? null : r.failure.code).toBe("conflict");
    expect(value(await w.vcs.head(REF))).toBe(a.commit);
  });

  test("keepFiles refuses no files, a nested or repeated path, a ref outside refs/, and a missing file", async () => {
    const w = await world();
    const src = onDisk(w.dir, { "a.txt": "a\n" });
    const at = join(src, "a.txt");
    const code = async (p: ReturnType<NonNullable<typeof w.vcs.keepFiles>>) => {
      const r = await p;
      return r.ok ? "ok" : r.failure.code;
    };
    expect(await code(w.vcs.keepFiles!(REF, [], "m"))).toBe("invalid");
    expect(await code(w.vcs.keepFiles!(REF, [{ path: "dir/a.txt", at }], "m"))).toBe("invalid");
    expect(await code(w.vcs.keepFiles!(REF, [{ path: "..", at }], "m"))).toBe("invalid");
    expect(await code(w.vcs.keepFiles!(REF, [{ path: "a.txt", at }, { path: "a.txt", at }], "m"))).toBe("invalid");
    expect(await code(w.vcs.keepFiles!("main", [{ path: "a.txt", at }], "m"))).toBe("invalid");
    expect(await code(w.vcs.keepFiles!(REF, [{ path: "a.txt", at: join(src, "gone.txt") }], "m"))).not.toBe("ok");
    expect(value(await w.vcs.head(REF))).toBeNull();
  });

  test("pushRef pushes the ref fast-forward, a repeat is a no-op, a diverged remote ref is refused, never forced", async () => {
    const w = await world();
    const src = onDisk(w.dir, { "a.txt": "a\n" });
    const first = value(await w.vcs.keepFiles!(REF, [{ path: "a.txt", at: join(src, "a.txt") }], "a"));
    value(await w.vcs.moveRef!(REF, first.commit));
    expect(value(await w.vcs.pushRef!(REF))).toEqual({ pushed: true });
    expect(await git(w.remote, "rev-parse", REF)).toBe(first.commit);
    expect(value(await w.vcs.pushRef!(REF))).toEqual({ pushed: false });

    const next = value(await w.vcs.keepFiles!(REF, [{ path: "b.txt", at: join(src, "a.txt") }], "b"));
    value(await w.vcs.moveRef!(REF, next.commit));
    expect(value(await w.vcs.pushRef!(REF))).toEqual({ pushed: true });
    expect(await git(w.remote, "rev-parse", REF)).toBe(next.commit);

    // another clone keeps its own evidence on the same ref: neither is pushed over the other
    const p = await w.person();
    const other = await commit(p, "elsewhere", { "x.txt": "x\n" });
    await git(p, "push", "-q", "--force", "origin", `${other}:${REF}`);
    const mine = value(await w.vcs.keepFiles!(REF, [{ path: "c.txt", at: join(src, "a.txt") }], "c"));
    value(await w.vcs.moveRef!(REF, mine.commit));
    const refused = await w.vcs.pushRef!(REF);
    expect(refused.ok ? null : refused.failure.code).toBe("conflict");
    expect(await git(w.remote, "rev-parse", REF)).toBe(other);
  });

  test("pushRef of a ref that names nothing is not_found", async () => {
    const w = await world();
    const r = await w.vcs.pushRef!(REF);
    expect(r.ok ? null : r.failure.code).toBe("not_found");
  });

  test("the pushed ref is no branch on the remote, and leaves the snapshot's digest as it was", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const before = value(await w.vcs.snapshot!(path));
    const src = onDisk(w.dir, { "a.txt": "a\n" });
    const kept = value(await w.vcs.keepFiles!(REF, [{ path: "a.txt", at: join(src, "a.txt") }], "a"));
    value(await w.vcs.moveRef!(REF, kept.commit));
    value(await w.vcs.pushRef!(REF));
    value(await w.vcs.fetch());

    expect(await git(w.repo, "ls-remote", "--heads", "origin")).not.toContain("evidence");
    expect(await git(w.repo, "branch", "-r")).not.toContain("evidence");
    expect(await git(w.repo, "branch", "-a")).not.toContain("evidence");
    expect(await git(w.repo, "ls-remote", "origin", REF)).toBe(`${kept.commit}\t${REF}`);
    expect(value(await w.vcs.snapshot!(path))).toEqual(before);
  });
});
