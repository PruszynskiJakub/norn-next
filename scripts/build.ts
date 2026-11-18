/**
 * Distribution build.
 *
 *   bun scripts/build.ts                 → dist/npm/   npm-ready @norn/cli (one bundle + package.json)
 *   bun scripts/build.ts --name @o/norn --registry <url>
 *                                        → dist/npm/   same, published under another name / registry
 *                                          (GitHub Packages needs the owner's scope: see .github/workflows/release.yml)
 *   bun scripts/build.ts --bin [target…] → dist/bin/   single-file binaries via `bun build --compile`
 *
 * The packs and harnesses import their assets as text, so the bundle carries every workflow, skill and
 * extension inside it: nothing is copied beside it.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CLI = join(ROOT, "packages", "cli");
const ENTRY = join(CLI, "src", "main.ts");
const DIST = join(ROOT, "dist");

export const BIN_TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const;
type BinTarget = (typeof BIN_TARGETS)[number];

function cliManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(CLI, "package.json"), "utf8")) as Record<string, unknown>;
}

function fail(logs: readonly unknown[]): never {
  for (const l of logs) console.error(l);
  process.exit(1);
}

export interface NpmOptions {
  /** published package name; defaults to the cli package's own name */
  name?: string;
  /** `publishConfig.registry` of the published package */
  registry?: string;
}

/** dist/npm: one bundle (all @norn/* and third-party deps inlined) and a publishable package.json. */
export async function buildNpm(opts: NpmOptions = {}): Promise<string> {
  const pkg = cliManifest();
  const out = join(DIST, "npm");
  rmSync(out, { recursive: true, force: true });
  const res = await Bun.build({ entrypoints: [ENTRY], outdir: out, naming: "norn.js", target: "bun" });
  if (!res.success) fail(res.logs);
  const keep = ["name", "version", "description", "keywords", "license", "author", "homepage", "repository", "bugs", "engines"];
  const manifest: Record<string, unknown> = Object.fromEntries(keep.filter((k) => k in pkg).map((k) => [k, pkg[k]]));
  Object.assign(manifest, { type: "module", bin: { norn: "norn.js" }, files: ["norn.js", "README.md", "CHANGELOG.md"] });
  if (opts.name) manifest.name = opts.name;
  if (opts.registry) manifest.publishConfig = { registry: opts.registry };
  writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const doc of ["README.md", "CHANGELOG.md"]) {
    try {
      cpSync(join(ROOT, doc), join(out, doc));
    } catch {}
  }
  return out;
}

/**
 * A recent macOS kills a compiled binary on start (exit 137) while it carries only the linker's ad-hoc
 * signature; signing it again ad hoc lets it run. Only a macOS host has codesign, and a binary built
 * elsewhere is signed when it is installed.
 */
function resign(file: string): void {
  const r = spawnSync("codesign", ["--force", "--sign", "-", file], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`codesign failed on ${file}`);
    process.exit(1);
  }
}

/** dist/bin/norn-<target>: self-contained executables. */
export async function buildBins(targets: readonly BinTarget[] = BIN_TARGETS): Promise<string[]> {
  const dir = join(DIST, "bin");
  mkdirSync(dir, { recursive: true });
  const outs: string[] = [];
  for (const t of targets) {
    const outfile = join(dir, `norn-${t}`);
    const res = await Bun.build({
      entrypoints: [ENTRY],
      target: "bun",
      compile: { target: `bun-${t}`, outfile },
      minify: true,
    } as Parameters<typeof Bun.build>[0]);
    if (!res.success) fail(res.logs);
    if (t.startsWith("darwin") && process.platform === "darwin") resign(outfile);
    outs.push(outfile);
  }
  return outs;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--bin") {
    const wanted = args.slice(1);
    const bad = wanted.filter((t) => !(BIN_TARGETS as readonly string[]).includes(t));
    if (bad.length) {
      console.error(`unknown target(s): ${bad.join(", ")}; known: ${BIN_TARGETS.join(", ")}`);
      process.exit(2);
    }
    for (const f of await buildBins(wanted.length ? (wanted as BinTarget[]) : BIN_TARGETS)) console.error(`built ${relative(ROOT, f)}`);
  } else {
    const opt = (flag: string) => {
      const i = args.indexOf(flag);
      return i >= 0 ? args[i + 1] : undefined;
    };
    console.error(`built ${relative(ROOT, await buildNpm({ name: opt("--name"), registry: opt("--registry") }))}`);
  }
}
