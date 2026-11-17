/**
 * Putting a plugin into `<home>/plugins`, the bun project the installed loader imports from. An npm
 * spec or a git URL goes through `bun add` there; a local path is linked, so a plugin being written
 * is picked up as it changes. Every process runs through the host's exec, so a test scripts it.
 * The plugins folder is shared by every repo on the machine; which plugin a repo runs, and at which
 * version, is its lock's to say.
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import { type HostContext, parseJson } from "@norn/plugin-api";
import { NonEmpty } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { configPaths, lockPath } from "../config/paths.ts";
import type { CliContext } from "../context.ts";
import { homePaths } from "../home.ts";
import { failure, refuse } from "../output.ts";
import { readLock } from "./lock.ts";

const PackageJson = Type.Object(
  {
    name: Type.Optional(NonEmpty),
    version: Type.Optional(NonEmpty),
    dependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  { additionalProperties: true },
);
type PackageJson = Static<typeof PackageJson>;

/** What a fresh plugins folder holds: enough for `bun add` to treat it as a project. */
const PLUGINS_PROJECT = `${JSON.stringify({ name: "norn-plugins", private: true, dependencies: {} }, null, 2)}\n`;

const INSTALL_TIMEOUT_MS = 300_000;

export const isLocalSpec = (spec: string): boolean => spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~") || spec.startsWith("file:");

/** The package name an npm spec names (`name`, `name@1`, `@scope/name@^2`), or null for a URL or tarball. */
export function npmName(spec: string): string | null {
  const m = /^(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(@[^/]+)?$/i.exec(spec);
  return m ? (m[1] as string) : null;
}

async function readPackage(files: HostContext["files"], path: string): Promise<PackageJson | null> {
  const text = await files.read(path);
  if (text === null) return null;
  const r = parseJson(PackageJson, text, path);
  if (!r.ok) throw failure(r.failure.message, null, "package_unreadable");
  return r.value;
}

export interface Installed {
  /** the package name, which the lock and the loader know it by */
  name: string;
  version: string;
  /** the spec as the lock keeps it: a local path made absolute */
  spec: string;
}

function localPath(spec: string, cwd: string, userHome: string): string {
  const bare = spec.replace(/^file:/, "");
  if (bare === "~" || bare.startsWith("~/")) return join(userHome, bare.slice(1));
  return isAbsolute(bare) ? bare : resolve(cwd, bare);
}

async function run(host: HostContext, argv: string[], cwd: string, what: string): Promise<void> {
  const r = await host.exec(argv, { cwd, timeoutMs: INSTALL_TIMEOUT_MS });
  if (r.code !== 0) throw refuse(`${what} failed: ${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).split("\n").slice(-3).join(" ")}`, "check the spec and your network, then try again", "plugin_install_failed");
}

async function link(host: HostContext, pluginsDir: string, spec: string, abs: string): Promise<Installed> {
  const pkg = await readPackage(host.files, join(abs, "package.json"));
  if (!pkg?.name) throw refuse(`${abs} holds no package.json with a name`, "norn plugin add <the folder of a norn plugin package>", "plugin_not_a_package");
  const target = join(pluginsDir, "node_modules", pkg.name);
  await run(host, ["mkdir", "-p", dirname(target)], pluginsDir, `making ${dirname(target)}`);
  await run(host, ["ln", "-sfn", abs, target], pluginsDir, `linking ${abs}`);
  return { name: pkg.name, version: pkg.version ?? "0.0.0", spec: abs };
}

async function bunAdd(host: HostContext, pluginsDir: string, spec: string): Promise<Installed> {
  const manifest = join(pluginsDir, "package.json");
  const before = (await readPackage(host.files, manifest))?.dependencies ?? {};
  await run(host, ["bun", "add", spec], pluginsDir, `bun add ${spec}`);
  const after = (await readPackage(host.files, manifest))?.dependencies ?? {};
  // a git URL or tarball says its name only once installed: the dependency bun added or changed is it
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  const name = npmName(spec) ?? (changed.length === 1 ? (changed[0] as string) : null);
  if (!name || !(name in after)) throw failure(`could not tell which package bun add ${spec} installed`, "norn plugin add <name>@<version>", "plugin_install_unknown");
  const pkg = await readPackage(host.files, join(pluginsDir, "node_modules", name, "package.json"));
  return { name, version: pkg?.version ?? after[name] ?? "unknown", spec };
}

/** Install or refresh `spec` in the plugins folder. */
export async function installPlugin(ctx: CliContext, spec: string): Promise<Installed> {
  const host = await ctx.host();
  const pluginsDir = homePaths(ctx.home).plugins;
  await host.files.create(join(pluginsDir, "package.json"), PLUGINS_PROJECT);
  return isLocalSpec(spec) ? link(host, pluginsDir, spec, localPath(spec, ctx.io.cwd, ctx.io.userHome)) : bunAdd(host, pluginsDir, spec);
}

/**
 * The lock a plugin command changes. Team mode is told by the committed config file being there, not
 * by the config loading: a broken config is no reason the plugins cannot be listed or fixed.
 */
export async function repoLock(ctx: CliContext) {
  const w = await ctx.repo();
  const paths = configPaths(w.home, w.repo.root);
  const team = (await w.ctx.files.read(paths.repo)) !== null;
  const path = lockPath(w.repo.root, w.machine, team);
  return { w, paths, team, path, lock: await readLock(w.ctx.files, path), pluginsDir: homePaths(w.home).plugins };
}
