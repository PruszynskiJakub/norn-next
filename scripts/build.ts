/**
 * X3 distribution build.
 *
 *   bun scripts/build.ts                 → dist/npm/   npm-ready @norn/cli (bundle + assets + package.json)
 *   bun scripts/build.ts --bin [target…] → dist/bin/   single-file binaries via `bun build --compile`
 *
 * Assets are found at run time by `packages/cli/src/runtime/assets.ts` (NORN_ASSETS_DIR →
 * embedded → `assets/` next to the bundle → source tree). The npm build copies them next to the
 * bundle; the compile build substitutes `runtime/embedded-assets.ts` with a generated module that
 * embeds every asset file (`with { type: "file" }`) plus a content hash.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { BunPlugin } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const CLI = join(ROOT, "packages", "cli");
const ENTRY = join(CLI, "src", "main.ts");
export const ASSETS = join(CLI, "assets");
const DIST = join(ROOT, "dist");

export const BIN_TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const;
type BinTarget = (typeof BIN_TARGETS)[number];

const EMBEDDED_MODULE = join(CLI, "src", "runtime", "embedded-assets.ts");

/** Every file under `dir`, as paths relative to it, sorted. */
export function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? listFiles(join(dir, d.name), base) : d.name.startsWith(".") ? [] : [relative(base, join(dir, d.name))]))
    .sort();
}

function assetsHash(version: string, files: string[]): string {
  const h = createHash("sha256").update(version).update("\0");
  for (const f of files) h.update(f).update("\0").update(readFileSync(join(ASSETS, f))).update("\0");
  return `${version}-${h.digest("hex").slice(0, 12)}`;
}

/** Generated replacement for `runtime/embedded-assets.ts` in compiled binaries. */
function embeddedSource(version: string): string {
  const files = listFiles(ASSETS);
  const imports = files.map((f, i) => `import a${i} from ${JSON.stringify(join(ASSETS, f))} with { type: "file" };`).join("\n");
  const table = files.map((f, i) => `    [${JSON.stringify(f)}, a${i}],`).join("\n");
  return `${imports}
export const EMBEDDED_ASSETS = {
  hash: ${JSON.stringify(assetsHash(version, files))},
  files: [
${table}
  ],
};
`;
}

/** Swaps the embedded-assets module for the generated one; the build fails if the module was never loaded. */
function embedAssetsPlugin(version: string): BunPlugin & { used: () => boolean } {
  let used = false;
  return {
    name: "norn-embed-assets",
    used: () => used,
    setup(build) {
      build.onLoad({ filter: /[\\/]embedded-assets\.ts$/ }, ({ path }) => {
        if (resolve(path) !== EMBEDDED_MODULE) return undefined;
        used = true;
        return { contents: embeddedSource(version), loader: "ts" };
      });
    },
  };
}

function cliManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(CLI, "package.json"), "utf8")) as Record<string, unknown>;
}

function fail(logs: readonly unknown[]): never {
  for (const l of logs) console.error(l);
  process.exit(1);
}

/** dist/npm: bundle (all @norn/* and third-party deps inlined), assets, publishable package.json. */
export async function buildNpm(): Promise<string> {
  const pkg = cliManifest();
  const out = join(DIST, "npm");
  rmSync(out, { recursive: true, force: true });
  const res = await Bun.build({
    entrypoints: [ENTRY],
    outdir: out,
    naming: "norn.js",
    target: "bun",
  });
  if (!res.success) fail(res.logs);
  cpSync(ASSETS, join(out, "assets"), { recursive: true });
  const keep = ["name", "version", "description", "keywords", "license", "author", "homepage", "repository", "bugs", "engines"];
  const manifest: Record<string, unknown> = Object.fromEntries(keep.filter((k) => k in pkg).map((k) => [k, pkg[k]]));
  Object.assign(manifest, { type: "module", bin: { norn: "norn.js" }, files: ["norn.js", "assets"] });
  writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const readme = join(ROOT, "README.md");
  try {
    cpSync(readme, join(out, "README.md"));
  } catch {}
  return out;
}

/** dist/bin/norn-<target>: self-contained executables with the assets embedded. */
export async function buildBins(targets: readonly BinTarget[] = BIN_TARGETS): Promise<string[]> {
  const version = String(cliManifest().version);
  const dir = join(DIST, "bin");
  mkdirSync(dir, { recursive: true });
  const outs: string[] = [];
  for (const t of targets) {
    const outfile = join(dir, `norn-${t}`);
    const embed = embedAssetsPlugin(version);
    const res = await Bun.build({
      entrypoints: [ENTRY],
      target: "bun",
      compile: { target: `bun-${t}`, outfile },
      minify: true,
      plugins: [embed],
    } as Parameters<typeof Bun.build>[0]);
    if (!res.success) fail(res.logs);
    if (!embed.used()) fail([`norn-embed-assets: ${relative(ROOT, EMBEDDED_MODULE)} was not part of the build; update scripts/build.ts`]);
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
    console.error(`built ${relative(ROOT, await buildNpm())}`);
  }
}
