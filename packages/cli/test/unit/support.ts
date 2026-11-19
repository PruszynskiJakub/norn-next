/** An in-memory machine for running the CLI in-process: files in memory, git answered by script, no child process. */
import { type ExecScript, type MemoryFiles, memoryFiles, memoryHost, type ScriptedExec, scriptedExec } from "@norn/conformance";
import type { CliIo, PluginImporter } from "../../src/index.ts";

export const HOME = "/home/me/.norn";
export const ROOT = "/work/repo";
export const COMMON = "/work/repo/.git";

/** Detached-process methods that start nothing: a runner needs them to be built, and no unit test starts an agent. */
const NO_PROCESSES = {
  spawn: async () => {
    throw new Error("no process starts in a unit test");
  },
  alive: async () => false,
  kill: async () => {},
};

export interface TestMachine {
  io: CliIo;
  files: MemoryFiles;
  /** every command run, `git rev-parse` included */
  exec: ScriptedExec;
}

export interface MachineOptions {
  seed?: Record<string, string>;
  cwd?: string;
  common?: string | null;
  stdin?: string;
  env?: Record<string, string>;
  /** answers every command but `git rev-parse`; unscripted ones fail as a missing binary would */
  script?: ExecScript;
  /** answers a `git rev-parse` before the checkout's own answer does, such as a ref in a unit's worktree */
  revParse?: ExecScript;
  importer?: PluginImporter;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

/** `cwd` inside the checkout (or a worktree of it); git answers `rev-parse` with `common`, or as outside a repo when null. */
export function machine(opts: MachineOptions = {}): TestMachine {
  const files = memoryFiles(opts.seed ?? {});
  const common = opts.common === undefined ? COMMON : opts.common;
  const cwd = opts.cwd ?? ROOT;
  const exec = scriptedExec((argv, o) => {
    if (argv[0] !== "git" || argv[1] !== "rev-parse") return opts.script?.(argv, o);
    const answered = opts.revParse?.(argv, o);
    if (answered !== undefined) return answered;
    if (common === null) return { code: 128, stderr: "fatal: not a git repository" };
    return { stdout: `${common}\n${cwd}\n` };
  });
  const io: CliIo = {
    env: { NORN_HOME_DIR: HOME, USER: "me", ...(opts.env ?? {}) },
    cwd,
    userHome: "/home/me",
    stdin: async () => opts.stdin ?? "",
    self: ["norn"],
    version: "9.9.9",
    hosts: { exec, host: (r) => ({ ...memoryHost({ files, exec, repo: { root: r.root, dataDir: r.dataDir } }), ...NO_PROCESSES }) },
    importer:
      opts.importer ??
      (async (name) => {
        throw new Error(`no plugin ${name} in this test`);
      }),
    hostname: "box",
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  };
  return { io, files, exec };
}

/** A complete repo-local config on bundled plugins. */
export const LOCAL_CONFIG = [
  "format: 1",
  "tracker:",
  "  use: local",
  "  intake: { label: norn }",
  "forge: { use: none }",
  "store: { use: local }",
  "executors:",
  "  claude: { harness: claude, runner: headless }",
  "",
].join("\n");

/** A GitHub repository as gh answers for it: labels defined, issues made, every gh call in order. */
export interface FakeGh {
  script: ExecScript;
  /** the labels the repository defines */
  labels: string[];
  /** each gh call as `<sub> <verb> <first arg>`, such as `label create norn` */
  calls: string[];
  /** gh refuses `label create`, as for a token without write access */
  refuseLabels?: boolean;
}

export function fakeGh(labels: string[] = []): FakeGh {
  const gh: FakeGh = {
    labels,
    calls: [],
    script: (argv) => {
      if (argv[0] !== "gh") return undefined;
      const [, sub, verb, first] = argv;
      if (sub === "--version") return { stdout: "gh 2.0\n" };
      if (sub === "repo" && verb === "view") return { stdout: '{"nameWithOwner":"acme/app"}' };
      if (sub === "api" && verb === "user") return { stdout: "me\n" };
      gh.calls.push(`${sub} ${verb}${first && !first.startsWith("-") ? ` ${first}` : ""}`);
      if (sub === "label" && verb === "list") return { stdout: JSON.stringify(gh.labels.map((name) => ({ name }))) };
      if (sub === "label" && verb === "create") {
        if (gh.refuseLabels) return { code: 1, stderr: "HTTP 403: Resource not accessible by integration" };
        gh.labels.push(first as string);
        return { stdout: "" };
      }
      if (sub === "issue" && verb === "list") return { stdout: "[]" };
      if (sub === "issue" && verb === "create") return { stdout: "https://github.com/acme/app/issues/7\n" };
      return undefined;
    },
  };
  return gh;
}

/** LOCAL_CONFIG on the github tracker. */
export const GITHUB_CONFIG = LOCAL_CONFIG.replace("use: local\n  intake", "use: github\n  intake");
