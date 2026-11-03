/**
 * gh-61 D2: the one version guard. A command that acts (D1) refuses, exit 3, when the running norn
 * does not match the `norn_version` the main checkout's team file records (B6, B7, B12). It runs in
 * the dispatcher after the repo is located, before the command, so a refused command writes,
 * launches and pushes nothing. `watch` runs it again before each tick (B11, D8).
 */
import { versionMismatch } from "@norn/core";
import type { Context } from "../context.ts";
import { type CliFailure, refuse } from "../output.ts";

/** The refusal, with the version the repo records and the line it needs, when the running norn does not match it; else null. */
export function versionRefusal(ctx: Context): { failure: CliFailure; repo: string; needs: string } | null {
  // B3: a config with problems is the command's own config error (exit 6), never a version refusal;
  // a command that does not read config (config set) can still fix it
  const loaded = ctx.loaded;
  if (!loaded.ok) return null;
  // B12: `ctx.loaded` is the main checkout's config, never a unit worktree's own team file
  const repo = loaded.config.norn_version;
  if (repo === null) return null; // B5: no key, no check
  const mismatch = versionMismatch(repo, ctx.version);
  if (!mismatch) return null;
  return { failure: refuse(mismatch.error, mismatch.do_instead, "version_mismatch", { repo, running: ctx.version }), repo, needs: mismatch.needs };
}

/** Throws the refusal when the repo records a version the running norn does not match. */
export function guardVersion(ctx: Context): void {
  const refusal = versionRefusal(ctx);
  if (refusal) throw refusal.failure;
}
