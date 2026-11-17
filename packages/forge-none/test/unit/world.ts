/**
 * A repo for forge "none" held in memory: the host's files, and a git that answers the two
 * questions the forge asks (rev-parse, merge-base --is-ancestor) from a small commit graph.
 */
import { type ForgeWorld, memoryFiles, memoryHost, type ScriptedExec, scriptedExec, steppingClock } from "@norn/conformance";
import { type HostContext, type HostFiles, parseJson } from "@norn/plugin-api";
import { ChangeRecord, encode, recordPath } from "../../src/record.ts";
import { noneForge } from "../../src/forge.ts";

export interface GitRepo {
  ctx: HostContext;
  exec: ScriptedExec;
  files: ReturnType<typeof memoryFiles>;
  /** a branch at a new commit on top of `from` (main by default) */
  branch(name: string, from?: string): string;
  /** a new commit on `name`, on top of its tip */
  commit(name: string): string;
  /** `into` takes `from`'s commits in a new merge commit `sha` (or fast-forwards when no sha) */
  merge(from: string, into: string, sha?: string): string;
  remove(name: string): void;
  tip(name: string): string | undefined;
  /** while on, git and every file call fail, as a broken disk or a missing git would */
  down(on: boolean): void;
  record(id: number): Promise<ChangeRecord>;
}

export function gitRepo(opts: { autoBranch?: boolean; files?: HostFiles } = {}): GitRepo {
  let n = 0;
  const mint = (): string => (++n).toString(16).padStart(40, "a");
  const reach = new Map<string, Set<string>>();
  const branches = new Map<string, string>();
  const commitOn = (parents: string[], sha = mint()): string => {
    const r = new Set([sha]);
    for (const p of parents) for (const c of reach.get(p) ?? []) r.add(c);
    reach.set(sha, r);
    return sha;
  };
  branches.set("main", commitOn([]));
  let broken = false;

  const exec = scriptedExec((argv) => {
    if (broken) return { code: 128, stderr: "fatal: injected" };
    const [git, cmd, ...rest] = argv;
    if (git !== "git") return undefined;
    if (cmd === "rev-parse" && rest[0] === "--verify" && rest[1] === "--quiet") {
      const ref = (rest[2] ?? "").replace(/\^\{commit\}$/, "");
      if (!branches.has(ref) && opts.autoBranch) branches.set(ref, commitOn([branches.get("main") as string]));
      const sha = branches.get(ref) ?? (reach.has(ref) ? ref : undefined);
      return sha ? { stdout: `${sha}\n` } : { code: 1 };
    }
    if (cmd === "merge-base" && rest[0] === "--is-ancestor") {
      const [a, b] = [rest[1] as string, rest[2] as string];
      if (!reach.has(a) || !reach.has(b)) return { code: 128, stderr: `fatal: Not a valid commit name ${reach.has(a) ? b : a}` };
      return { code: reach.get(b)?.has(a) ? 0 : 1 };
    }
    return undefined;
  });

  const mem = memoryFiles();
  const inner = opts.files ?? mem;
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    if (broken) throw new Error("injected: disk unreadable");
    return run();
  };
  const files: HostFiles = {
    read: (p) => guard(() => inner.read(p)),
    list: (d) => guard(() => inner.list(d)),
    write: (p, d) => guard(() => inner.write(p, d)),
    create: (p, d) => guard(() => inner.create(p, d)),
    remove: (p) => guard(() => inner.remove(p)),
  };
  const ctx = memoryHost({ exec, files, now: steppingClock("2026-11-17T10:00:00.000Z"), repo: { root: "/repo", dataDir: "/machine/repo" } });

  return {
    ctx,
    exec,
    files: mem,
    branch: (name, from = "main") => {
      const sha = commitOn([branches.get(from) as string]);
      branches.set(name, sha);
      return sha;
    },
    commit: (name) => {
      const sha = commitOn([branches.get(name) as string]);
      branches.set(name, sha);
      return sha;
    },
    merge: (from, into, sha) => {
      const tip = sha ? commitOn([branches.get(into) as string, branches.get(from) as string], sha) : (branches.get(from) as string);
      branches.set(into, tip);
      return tip;
    },
    remove: (name) => {
      branches.delete(name);
    },
    tip: (name) => branches.get(name),
    down: (on) => {
      broken = on;
    },
    record: async (id) => {
      const path = recordPath(ctx, id);
      const r = parseJson(ChangeRecord, (await inner.read(path)) ?? "", path);
      if (!r.ok) throw new Error(r.failure.message);
      return r.value;
    },
  };
}

/** The contract suite's world: any branch the suite names exists, one commit ahead of main. */
export function contractWorld(): ForgeWorld {
  const repo = gitRepo({ autoBranch: true });
  const forge = noneForge(repo.ctx);
  return {
    forge,
    failing: (on) => repo.down(on),
    merge: async (id, sha) => {
      repo.merge((await repo.record(id)).head_branch, "main", sha);
    },
    close: async (id) => {
      const rec = await repo.record(id);
      await repo.ctx.files.write(recordPath(repo.ctx, id), encode({ ...rec, closed_at: repo.ctx.now() }));
    },
    // forge "none" reports no checks; the suite expects "none" whatever is set
    setChecks: async () => {},
  };
}
