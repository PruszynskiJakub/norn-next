import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost, type ScriptedAnswer, scriptedExec } from "@norn/conformance";
import type { HostContext, StepKindInput } from "@norn/plugin-api";
import { bookkeeping, integrate, type LightCommit, lightOutcome, push, updateBranch, verifyBase } from "../../src/index.ts";

const ROOT = "/repo";
const DATA = "/machine/repo";
const WT = `${DATA}/worktrees/gh-12`;
const HEAD = "1".repeat(40);
const BASE = "2".repeat(40);
const TRACK = "3".repeat(40);
const MERGED = "4".repeat(40);

type Router = (line: string, cwd: string | undefined) => ScriptedAnswer | undefined;

function host(route: Router, files = memoryFiles()) {
  const exec = scriptedExec((argv, opts) => route(argv.slice(1).join(" "), opts.cwd));
  const ctx: HostContext = memoryHost({ exec, files, repo: { root: ROOT, dataDir: DATA } });
  return { ctx, exec, lines: () => exec.calls.map((c) => c.argv.slice(1).join(" ")) };
}

const input = <C>(config: C, over: Partial<StepKindInput<C>> = {}): StepKindInput<C> => ({ unit: "gh-12", story: "gh-12", step: "update", config, worktree: WT, ...over });
const rev = (ref: string) => `rev-parse --verify --quiet --end-of-options ${ref}^{commit}`;
const DIFF = "-c core.quotePath=false diff";
/** A diff adding one whole conflict to src/a.ts at line 4, its markers built so no line here reads as one. */
const CONFLICTED = ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -3,0 +4,3 @@", `+${"<".repeat(7)} HEAD`, `+${"=".repeat(7)}`, `+${">".repeat(7)} main`, ""].join("\n");

describe("the light path", () => {
  const merge = (over: Partial<LightCommit> = {}): LightCommit => ({ sha: "m", parents: ["a", "b"], paths: [], fromBase: true, remerge: [], ...over });
  const commit = (paths: string[]): LightCommit => ({ sha: "c", parents: ["a"], paths });

  test("bookkeeping is the story's spec folder, never its spec.md nor another story's folder", () => {
    expect(bookkeeping(".agents/specs/gh-12-login/handoffs/gh-12.md", "gh-12")).toBe(true);
    expect(bookkeeping(".agents/specs/gh-12-login/spec.md", "gh-12")).toBe(false);
    expect(bookkeeping(".agents/specs/gh-123-other/notes.md", "gh-12")).toBe(false);
    expect(bookkeeping("src/a.ts", "gh-12")).toBe(false);
  });

  test("base merges git made alone are clean, one a resolver finished is resolved, anything else takes the full path", () => {
    expect(lightOutcome([merge(), commit([".agents/specs/gh-12-login/pr.md"])], "gh-12")).toBe("clean");
    expect(lightOutcome([], "gh-12")).toBe("clean");
    expect(lightOutcome([merge(), merge({ remerge: ["a.ts"] })], "gh-12")).toBe("resolved");
    expect(lightOutcome([merge({ remerge: null })], "gh-12")).toBe("resolved");
    expect(lightOutcome([merge(), commit(["src/a.ts"])], "gh-12")).toBeNull();
    expect(lightOutcome([merge({ fromBase: false })], "gh-12")).toBeNull();
  });
});

/** A story worktree at HEAD, clean, with origin; `over` answers first. */
function storyRouter(over: Router, state: { head: string }): Router {
  return (line, cwd) => {
    const o = over(line, cwd);
    if (o !== undefined) return o;
    if (line === "symbolic-ref --quiet --short HEAD") return { stdout: "gh-12-login\n" };
    if (line === "remote") return { stdout: "origin\n" };
    if (line.startsWith("fetch")) return {};
    if (line.startsWith("status --porcelain")) return { stdout: "" };
    if (line.startsWith(DIFF)) return { stdout: "" };
    if (line === rev("HEAD")) return { stdout: state.head };
    if (line === rev("origin/main")) return { stdout: BASE };
    if (line.startsWith("rev-parse")) return { code: 1 };
    return undefined;
  };
}

describe("update-branch", () => {
  test("merges the base with a merge commit, never rebasing, and takes the full path without a published branch", async () => {
    const state = { head: HEAD };
    const h = host(
      storyRouter((line) => {
        if (line === `merge-base --is-ancestor ${BASE} HEAD`) return { code: 1 };
        if (line.startsWith("merge --no-ff --no-edit")) {
          state.head = MERGED;
          return {};
        }
        return undefined;
      }, state),
    );
    const r = await updateBranch.run(input({ base: "origin/main" }), h.ctx);
    expect(r).toEqual({ ok: true, value: { outcome: "done", detail: { base: { ref: "origin/main", sha: BASE }, head: MERGED, merged: true } } });
    expect(h.lines()).toContain(`merge --no-ff --no-edit -m Update gh-12 from origin/main (${BASE.slice(0, 7)}) ${BASE}`);
    expect(h.lines().some((l) => l.startsWith("rebase") || l.startsWith("push"))).toBe(false);
  });

  test("a conflict aborts the merge and names the base commit and the paths for the resolver", async () => {
    let inMerge = false;
    const h = host(
      storyRouter((line) => {
        if (line === `merge-base --is-ancestor ${BASE} HEAD`) return { code: 1 };
        if (line === rev("MERGE_HEAD")) return inMerge ? { stdout: BASE } : { code: 1 };
        if (line.startsWith("merge --no-ff")) {
          inMerge = true;
          return { code: 1 };
        }
        if (line.startsWith("diff --name-only --diff-filter=U")) return { stdout: "src/a.ts\n" };
        if (line === "merge --abort") {
          inMerge = false;
          return {};
        }
        return undefined;
      }, { head: HEAD }),
    );
    const r = await updateBranch.run(input({}), h.ctx);
    expect(r).toEqual({ ok: true, value: { outcome: "conflict", detail: { base: { ref: "origin/main", sha: BASE }, conflicts: ["src/a.ts"] } } });
    expect(h.lines()).toContain("merge --abort");
  });

  test("measures the light path from the published branch while its change is open", async () => {
    const published = () => {
      const state = { head: HEAD };
      return host(
      storyRouter((line) => {
        if (line === rev("refs/remotes/origin/gh-12-login")) return { stdout: TRACK };
        if (line === `merge-base --is-ancestor ${TRACK} HEAD`) return { code: 0 };
        if (line === `merge-base --is-ancestor ${BASE} HEAD`) return { code: 1 };
        if (line.startsWith("merge --no-ff")) {
          state.head = MERGED;
          return {};
        }
        if (line.startsWith(`rev-list --first-parent --parents ${TRACK}..HEAD`)) return { stdout: `${MERGED} ${TRACK} ${BASE}\n` };
        if (line === `merge-base --is-ancestor ${BASE} ${BASE}`) return { code: 0 };
        if (line.startsWith(`show --remerge-diff`)) return { stdout: "" };
        return undefined;
      }, state),
      );
    };
    const open = { id: 7, state: "open" as const, draft: true, head_branch: "gh-12-login", base_branch: "main", head_sha: TRACK, title: "t" };
    const forge = { name: "f", capabilities: { draft: true, checks: false, raw_urls: false }, findChanges: async () => ({ ok: true as const, value: { "gh-12-login": open } }), checks: async () => ({ ok: true as const, value: "none" as const }), perform: async () => ({ ok: false as const, failure: { code: "invalid" as const, message: "no", retryable: false } }) };
    const r = await updateBranch.run(input({}, { slots: { forge } }), published().ctx);
    expect(r.ok && r.value.outcome).toBe("clean");
    const closed = await updateBranch.run(input({}, { slots: { forge: { ...forge, findChanges: async () => ({ ok: true as const, value: { "gh-12-login": { ...open, state: "closed" as const } } }) } } }), published().ctx);
    expect(closed.ok && closed.value.outcome).toBe("done");
  });

  test("a merge in progress or uncommitted changes fail the step before anything changes", async () => {
    const h = host(storyRouter((line) => (line === rev("MERGE_HEAD") ? { stdout: BASE } : undefined), { head: HEAD }));
    const r = await updateBranch.run(input({}), h.ctx);
    expect(r.ok ? null : r.failure).toMatchObject({ code: "conflict", retryable: false });
    expect(h.lines().some((l) => l.startsWith("fetch") || l.startsWith("merge "))).toBe(false);
  });

  test("a worktree on another branch than the host's is refused", async () => {
    const h = host(storyRouter(() => undefined, { head: HEAD }));
    const r = await updateBranch.run(input({}, { branch: "gh-12-other" }), h.ctx);
    expect(r.ok ? null : r.failure.code).toBe("conflict");
  });
});

describe("integrate", () => {
  const SLICE_WT = `${DATA}/worktrees/gh-12-03`;
  const slice = (over: Partial<StepKindInput<Record<string, never>>> = {}) => input<Record<string, never>>({}, { unit: "gh-12/03", step: "integrate", worktree: SLICE_WT, ...over });

  test("merges the slice head into the story branch in the story's worktree", async () => {
    let merged = false;
    const h = host((line, cwd) => {
      if (line === "symbolic-ref --quiet --short HEAD") return { stdout: cwd === SLICE_WT ? "gh-12-03-form\n" : "gh-12-login\n" };
      if (line === rev("HEAD")) return { stdout: cwd === SLICE_WT ? HEAD : merged ? MERGED : BASE };
      if (line === `merge-base --is-ancestor ${HEAD} HEAD`) return { code: 1 };
      if (line.startsWith("rev-parse")) return { code: 1 };
      if (line.startsWith("status --porcelain")) return { stdout: "" };
      if (line.startsWith(DIFF)) return { stdout: "" };
      if (line.startsWith("merge --no-ff --no-edit")) {
        merged = true;
        return {};
      }
      return undefined;
    });
    const r = await integrate.run(slice(), h.ctx);
    expect(r).toEqual({ ok: true, value: { outcome: "done", detail: { story_branch: "gh-12-login", head: MERGED, merged: true } } });
    const call = h.exec.calls.find((c) => c.argv[1] === "merge");
    expect(call?.opts.cwd).toBe(WT);
    expect(call?.argv.slice(-1)).toEqual([HEAD]);
    expect(h.lines().some((l) => l.startsWith("rebase"))).toBe(false);
  });

  test("a slice already in the story branch is done without a merge", async () => {
    const h = host((line, cwd) => {
      if (line === "symbolic-ref --quiet --short HEAD") return { stdout: cwd === SLICE_WT ? "gh-12-03-form\n" : "gh-12-login\n" };
      if (line === rev("HEAD")) return { stdout: cwd === SLICE_WT ? HEAD : MERGED };
      if (line === `merge-base --is-ancestor ${HEAD} HEAD`) return { code: 0 };
      return undefined;
    });
    const r = await integrate.run(slice(), h.ctx);
    expect(r.ok && r.value).toEqual({ outcome: "done", detail: { story_branch: "gh-12-login", head: MERGED, merged: false } });
  });

  test("a slice whose commits left a conflict unresolved is refused, naming file and line, and nothing is merged", async () => {
    const h = host((line, cwd) => {
      if (line === "symbolic-ref --quiet --short HEAD") return { stdout: cwd === SLICE_WT ? "gh-12-03-form\n" : "gh-12-login\n" };
      if (line === rev("HEAD")) return { stdout: cwd === SLICE_WT ? HEAD : BASE };
      if (line === `merge-base --is-ancestor ${HEAD} HEAD`) return { code: 1 };
      if (line.startsWith(DIFF)) return { stdout: CONFLICTED };
      return undefined;
    });
    const r = await integrate.run(slice(), h.ctx);
    expect(r.ok ? null : { code: r.failure.code, retryable: r.failure.retryable }).toEqual({ code: "conflict", retryable: false });
    expect(r.ok ? "" : r.failure.message).toContain("src/a.ts:4");
    expect(h.lines()).toContain(`${DIFF} -U0 --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ gh-12-login...${HEAD}`);
    expect(h.lines().some((l) => l.startsWith("merge "))).toBe(false);
  });

  test("a story is never integrated into itself", async () => {
    const r = await integrate.run(slice({ unit: "gh-12" }), host(() => undefined).ctx);
    expect(r.ok ? null : r.failure.code).toBe("invalid");
  });
});

describe("push", () => {
  test("pushes fast-forward only, never leased on the fetched tracking ref, which may already hold a person's commits", async () => {
    const h = host(
      storyRouter((line) => {
        if (line.startsWith("push")) return {};
        return undefined;
      }, { head: HEAD }),
    );
    const r = await push.run(input({}, { step: "push" }), h.ctx);
    expect(r.ok && r.value.outcome).toBe("done");
    expect(h.lines()).toContain("push --porcelain origin refs/heads/gh-12-login:refs/heads/gh-12-login");
    expect(h.lines().some((l) => l.includes("force"))).toBe(false);
  });

  test("a person's push to the branch is merged in with a merge commit before the push, never rebased or forced", async () => {
    const state = { head: HEAD };
    const h = host(
      storyRouter((line) => {
        if (line === rev("refs/remotes/origin/gh-12-login")) return { stdout: TRACK };
        if (line === `merge-base --is-ancestor ${TRACK} HEAD`) return { code: 1 };
        if (line === `merge-base --is-ancestor HEAD ${TRACK}`) return { code: 1 };
        if (line.startsWith("merge --no-ff --no-edit")) {
          state.head = MERGED;
          return {};
        }
        if (line.startsWith("push")) return {};
        return undefined;
      }, state),
    );
    const r = await push.run(input({}, { step: "push" }), h.ctx);
    expect(r.ok && r.value).toEqual({ outcome: "done", detail: { branch: "gh-12-login", head: MERGED, took_remote: TRACK, remote: "origin" } });
    const lines = h.lines();
    const merge = lines.indexOf(`merge --no-ff --no-edit -m Merge origin/gh-12-login into gh-12-login ${TRACK}`);
    expect(merge).toBeGreaterThanOrEqual(0);
    expect(lines.findIndex((l) => l.startsWith("push"))).toBeGreaterThan(merge);
    expect(lines.some((l) => l.startsWith("rebase") || l.includes("force"))).toBe(false);
  });

  test("a person's push that conflicts is aborted and refused for a person; nothing is pushed", async () => {
    let inMerge = false;
    const h = host(
      storyRouter((line) => {
        if (line === rev("refs/remotes/origin/gh-12-login")) return { stdout: TRACK };
        if (line.startsWith("merge-base --is-ancestor")) return { code: 1 };
        if (line === rev("MERGE_HEAD")) return inMerge ? { stdout: TRACK } : { code: 1 };
        if (line.startsWith("merge --no-ff")) {
          inMerge = true;
          return { code: 1 };
        }
        if (line.startsWith("diff --name-only --diff-filter=U")) return { stdout: "src/a.ts\n" };
        if (line === "merge --abort") {
          inMerge = false;
          return {};
        }
        return undefined;
      }, { head: HEAD }),
    );
    const r = await push.run(input({}, { step: "push" }), h.ctx);
    expect(r.ok ? null : { code: r.failure.code, retryable: r.failure.retryable }).toEqual({ code: "conflict", retryable: false });
    expect(r.ok ? "" : r.failure.message).toContain("src/a.ts");
    expect(h.lines()).toContain("merge --abort");
    expect(h.lines().some((l) => l.startsWith("push"))).toBe(false);
  });
});

describe("push guard", () => {
  test("a branch whose commits left a conflict unresolved since its base is refused, naming file and line; nothing is pushed", async () => {
    const h = host(
      storyRouter((line) => {
        if (line.startsWith(DIFF)) return { stdout: CONFLICTED };
        if (line.startsWith("push")) return {};
        return undefined;
      }, { head: HEAD }),
    );
    const r = await push.run(input({}, { step: "push", base: { branch: "main", ref: "origin/main" } }), h.ctx);
    expect(r.ok ? null : { code: r.failure.code, retryable: r.failure.retryable }).toEqual({ code: "conflict", retryable: false });
    expect(r.ok ? "" : r.failure.message).toContain("src/a.ts:4");
    expect(h.lines().some((l) => l.startsWith(DIFF) && l.endsWith("origin/main...HEAD"))).toBe(true);
    expect(h.lines().some((l) => l.startsWith("push"))).toBe(false);
  });

  test("a repo where no base resolves still pushes, with no base to read conflicts against", async () => {
    const h = host(
      storyRouter((line) => {
        if (line === rev("origin/main")) return { code: 1 };
        if (line.startsWith("push")) return {};
        return undefined;
      }, { head: HEAD }),
    );
    const r = await push.run(input({}, { step: "push" }), h.ctx);
    expect(r.ok && r.value.outcome).toBe("done");
    expect(h.lines().some((l) => l.startsWith(DIFF))).toBe(false);
    expect(h.lines().some((l) => l.startsWith("push"))).toBe(true);
  });
});

describe("verify-base", () => {
  const cfg = { command: "bun test" };
  const SCRATCH = `${DATA}/worktrees/.verify-gh-12`;

  function verifyRouter(state: { testExit: number; conflict?: boolean }): Router {
    return storyRouter((line, cwd) => {
      if (line === `merge-base --is-ancestor ${BASE} ${HEAD}`) return { code: 1 };
      if (line.startsWith("worktree remove") || line === "worktree prune" || line.startsWith("worktree add")) return {};
      if (cwd === SCRATCH && line.startsWith("merge --no-ff --no-commit")) return state.conflict ? { code: 1 } : {};
      if (cwd === SCRATCH && line.startsWith("diff --name-only --diff-filter=U")) return { stdout: "src/a.ts\n" };
      if (line === "-c bun test") return { code: state.testExit, stdout: "1 fail\n" };
      return undefined;
    }, { head: HEAD });
  }

  test("tests the merge of the base into the head in a scratch worktree, once per pair", async () => {
    const files = memoryFiles();
    const h = host(verifyRouter({ testExit: 1 }), files);
    const r = await verifyBase.run(input(cfg, { step: "verify" }), h.ctx);
    expect(r.ok && r.value.outcome).toBe("broken");
    const run = h.exec.calls.find((c) => c.argv[0] === "sh");
    expect(run?.opts.cwd).toBe(SCRATCH);
    expect(h.lines()).toContain(`worktree add --detach --quiet ${SCRATCH} ${HEAD}`);
    expect(h.lines().some((l) => l.startsWith("commit"))).toBe(false);

    const again = host(verifyRouter({ testExit: 0 }), files);
    const r2 = await verifyBase.run(input(cfg, { step: "verify" }), again.ctx);
    expect(r2.ok && r2.value.outcome).toBe("waiting");
    expect(again.exec.calls.some((c) => c.argv[0] === "sh")).toBe(false);
  });

  test("green is verified; a conflicting base is left to the stale route; a story holding the base waits", async () => {
    const green = await verifyBase.run(input(cfg, { step: "verify" }), host(verifyRouter({ testExit: 0 })).ctx);
    expect(green.ok && green.value.outcome).toBe("verified");
    const conflict = await verifyBase.run(input(cfg, { step: "verify" }), host(verifyRouter({ testExit: 0, conflict: true })).ctx);
    expect(conflict.ok && conflict.value).toMatchObject({ outcome: "waiting", detail: { conflicts: ["src/a.ts"] } });
    const holds = host(storyRouter((line) => (line === `merge-base --is-ancestor ${BASE} ${HEAD}` ? { code: 0 } : undefined), { head: HEAD }));
    const h = await verifyBase.run(input(cfg, { step: "verify" }), holds.ctx);
    expect(h.ok && h.value.outcome).toBe("waiting");
    expect(holds.lines().some((l) => l.startsWith("worktree add"))).toBe(false);
  });
});
