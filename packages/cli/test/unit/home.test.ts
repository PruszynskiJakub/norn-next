import { describe, expect, test } from "bun:test";
import { scriptedExec } from "@norn/conformance";
import { CliFailure, ExitCode, homePaths, locateRepo, machineDir, machineId, nornHome } from "../../src/index.ts";

/** git as it answers `rev-parse --git-common-dir --show-toplevel` from each folder. */
function git(answers: Record<string, { common: string; top: string } | null>) {
  return scriptedExec((argv, opts) => {
    if (argv.slice(0, 2).join(" ") !== "git rev-parse") return undefined;
    const a = answers[opts.cwd ?? ""];
    return a ? { stdout: `${a.common}\n${a.top}\n` } : { code: 128, stderr: "fatal: not a git repository" };
  });
}

describe("norn home", () => {
  test("NORN_HOME_DIR when set, else ~/.norn", () => {
    expect(nornHome({ NORN_HOME_DIR: "/tmp/h" }, "/home/me")).toBe("/tmp/h");
    expect(nornHome({}, "/home/me")).toBe("/home/me/.norn");
    expect(nornHome({ NORN_HOME_DIR: "" }, "/home/me")).toBe("/home/me/.norn");
  });

  test("the user config, the plugins project, the holder file and each checkout's machine dir live under it", () => {
    expect(homePaths("/h")).toEqual({ userConfig: "/h/config.yaml", plugins: "/h/plugins", repos: "/h/repos", holder: "/h/holder.json" });
    expect(machineDir("/h", "repo-1234abcd")).toBe("/h/repos/repo-1234abcd");
  });
});

describe("machine dir id", () => {
  test("named after the checkout's folder, unique per common dir", () => {
    const id = machineId("/work/repo/.git");
    expect(id).toMatch(/^repo-[0-9a-f]{8}$/);
    expect(machineId("/work/repo/.git")).toBe(id);
    expect(machineId("/elsewhere/repo/.git")).not.toBe(id);
    expect(machineId("/srv/mirror.git")).toMatch(/^mirror-[0-9a-f]{8}$/);
  });

  test("worktrees of one repository share the id and the root; another clone does not", async () => {
    const exec = git({
      "/work/repo": { common: "/work/repo/.git", top: "/work/repo" },
      "/work/repo/src": { common: "/work/repo/.git", top: "/work/repo" },
      "/home/me/.norn/repos/x/worktrees/gh-1": { common: "/work/repo/.git", top: "/home/me/.norn/repos/x/worktrees/gh-1" },
      "/work/clone": { common: "/work/clone/.git", top: "/work/clone" },
    });
    const main = await locateRepo(exec, "/work/repo");
    const sub = await locateRepo(exec, "/work/repo/src");
    const worktree = await locateRepo(exec, "/home/me/.norn/repos/x/worktrees/gh-1");
    const clone = await locateRepo(exec, "/work/clone");
    expect(main).toEqual({ root: "/work/repo", common: "/work/repo/.git", id: machineId("/work/repo/.git") });
    expect(sub).toEqual(main);
    expect(worktree).toEqual(main);
    expect(clone.id).not.toBe(main.id);
    expect(exec.calls[0]?.argv).toEqual(["git", "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]);
  });

  test("a worktree of a bare repository is its own root", async () => {
    const exec = git({ "/wt/a": { common: "/srv/repo.git", top: "/wt/a" } });
    expect(await locateRepo(exec, "/wt/a")).toEqual({ root: "/wt/a", common: "/srv/repo.git", id: machineId("/srv/repo.git") });
  });

  test("outside a git repository: refused, exit 3, code not_a_repo", async () => {
    const e = await locateRepo(git({}), "/tmp").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CliFailure);
    expect({ exit: (e as CliFailure).exit, code: (e as CliFailure).body.code }).toEqual({ exit: ExitCode.refused, code: "not_a_repo" });
  });
});
