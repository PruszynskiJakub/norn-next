/**
 * What `norn init` can tell about a repository before the first story: its test command, for the
 * `test` check steps of the workflow templates (W1), and whether the git remote norn pushes to exists.
 * A check runs in a fresh worktree with no installed dependencies (F3), so a JS command installs first.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DetectedTestCommand {
  command: string;
  /** the file it was read from, e.g. `package.json` */
  from: string;
}

/** npm's placeholder for a project without tests */
const NPM_NO_TEST = /no test specified/;

function packageJsonTest(root: string): DetectedTestCommand | null {
  let pkg: { scripts?: Record<string, unknown> };
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const has = (f: string) => existsSync(join(root, f));
  const script = pkg.scripts?.test;
  const hasScript = typeof script === "string" && !NPM_NO_TEST.test(script);
  const from = "package.json";
  if (has("bun.lock") || has("bun.lockb")) return { command: `bun install --frozen-lockfile && ${hasScript ? "bun run test" : "bun test"}`, from };
  if (!hasScript) return null;
  if (has("pnpm-lock.yaml")) return { command: "pnpm install --frozen-lockfile && pnpm test", from };
  if (has("yarn.lock")) return { command: "yarn install && yarn test", from };
  return { command: has("package-lock.json") ? "npm ci && npm test" : "npm install && npm test", from };
}

function makeTest(root: string): boolean {
  try {
    return /^test\s*:/m.test(readFileSync(join(root, "Makefile"), "utf8"));
  } catch {
    return false;
  }
}

/** The repository's test command from its build files, or null when nothing says. */
export function detectTestCommand(root: string): DetectedTestCommand | null {
  const has = (f: string) => existsSync(join(root, f));
  const js = packageJsonTest(root);
  if (js) return js;
  if (has("Cargo.toml")) return { command: "cargo test", from: "Cargo.toml" };
  if (has("go.mod")) return { command: "go test ./...", from: "go.mod" };
  if (has("uv.lock")) return { command: "uv run pytest", from: "uv.lock" };
  for (const f of ["pyproject.toml", "pytest.ini", "setup.py", "tox.ini"]) if (has(f)) return { command: "pytest", from: f };
  if (has("mix.exs")) return { command: "mix test", from: "mix.exs" };
  if (has("gradlew")) return { command: "./gradlew test", from: "gradlew" };
  if (has("pom.xml")) return { command: "mvn test", from: "pom.xml" };
  if (makeTest(root)) return { command: "make test", from: "Makefile" };
  return null;
}

/** The test command the bundled workflow templates ship with. */
export const TEMPLATE_TEST_COMMAND = "bun test";

/** A workflow template with its `run: bun test` lines set to `command` (quoted, YAML-safe). */
export function withTestCommand(yaml: string, command: string): string {
  return yaml.replace(/^(\s+run:) bun test[ \t]*$/gm, (_m, key: string) => `${key} ${JSON.stringify(command)}`);
}

/** The fetch URL of the named git remote, or null when the repository has no such remote. */
export function gitRemoteUrl(root: string, name: string): string | null {
  const r = Bun.spawnSync(["git", "remote", "get-url", name], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString().trim() || null : null;
}
