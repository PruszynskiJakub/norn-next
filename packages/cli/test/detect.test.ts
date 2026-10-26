/** `norn init`'s look at a repository (W1, F3): its test command from build files, and the template rewrite. */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTestCommand, withTestCommand } from "../src/runtime/detect.ts";

let dirs: string[] = [];
const repo = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "norn-detect-"));
  dirs.push(dir);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  return dir;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const pkg = (test?: string) => JSON.stringify({ name: "app", ...(test ? { scripts: { test } } : {}) });

describe("detectTestCommand", () => {
  test("a JS repo installs with its package manager, then runs its test script", () => {
    expect(detectTestCommand(repo({ "package.json": pkg("vitest run"), "package-lock.json": "{}" }))).toEqual({ command: "npm ci && npm test", from: "package.json" });
    expect(detectTestCommand(repo({ "package.json": pkg("vitest run") }))?.command).toBe("npm install && npm test");
    expect(detectTestCommand(repo({ "package.json": pkg("jest"), "pnpm-lock.yaml": "" }))?.command).toBe("pnpm install --frozen-lockfile && pnpm test");
    expect(detectTestCommand(repo({ "package.json": pkg("jest"), "yarn.lock": "" }))?.command).toBe("yarn install && yarn test");
    expect(detectTestCommand(repo({ "package.json": pkg("vitest"), "bun.lock": "" }))?.command).toBe("bun install --frozen-lockfile && bun run test");
    // bun's own runner needs no script
    expect(detectTestCommand(repo({ "package.json": pkg(), "bun.lockb": "" }))?.command).toBe("bun install --frozen-lockfile && bun test");
  });

  test("npm's placeholder script and an unreadable package.json name nothing", () => {
    expect(detectTestCommand(repo({ "package.json": pkg('echo "Error: no test specified" && exit 1') }))).toBeNull();
    expect(detectTestCommand(repo({ "package.json": "{not json" }))).toBeNull();
  });

  test("other ecosystems by their build file; a Makefile only with a test target", () => {
    expect(detectTestCommand(repo({ "Cargo.toml": "" }))).toEqual({ command: "cargo test", from: "Cargo.toml" });
    expect(detectTestCommand(repo({ "go.mod": "" }))?.command).toBe("go test ./...");
    expect(detectTestCommand(repo({ "pyproject.toml": "", "uv.lock": "" }))?.command).toBe("uv run pytest");
    expect(detectTestCommand(repo({ "pyproject.toml": "" }))).toEqual({ command: "pytest", from: "pyproject.toml" });
    expect(detectTestCommand(repo({ "mix.exs": "" }))?.command).toBe("mix test");
    expect(detectTestCommand(repo({ gradlew: "" }))?.command).toBe("./gradlew test");
    expect(detectTestCommand(repo({ "pom.xml": "" }))?.command).toBe("mvn test");
    expect(detectTestCommand(repo({ Makefile: "build:\n\tcc x.c\ntest: build\n\t./t\n" }))).toEqual({ command: "make test", from: "Makefile" });
    expect(detectTestCommand(repo({ Makefile: "build:\n\tcc x.c\n" }))).toBeNull();
    expect(detectTestCommand(repo({ "README.md": "# app" }))).toBeNull();
  });
});

describe("withTestCommand", () => {
  test("replaces the template's `run: bun test` lines only, quoted for YAML", () => {
    const yaml = "steps:\n  test:\n    type: check\n    run: bun test\n    timeout: 15m\n  lint:\n    run: bun test:lint\n";
    expect(withTestCommand(yaml, "npm ci && npm test")).toBe('steps:\n  test:\n    type: check\n    run: "npm ci && npm test"\n    timeout: 15m\n  lint:\n    run: bun test:lint\n');
  });
});
