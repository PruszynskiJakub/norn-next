/**
 * A command that acts refuses, exit 3, when the running norn
 * does not match the `norn_version` the main checkout's team file records. It runs in
 * the dispatcher after the repo is located, before the command, so a refused command writes,
 * launches and pushes nothing. `watch` runs it again before each tick.
 */
import { versionMismatch } from "@norn/core";
import type { Context } from "../context.ts";
import { type CliFailure, refuse } from "../output.ts";

/** The `X.Y.Z` a running version is compared by: a dev or pre-release build (`0.19.0-dev.3`) by its core. */
export const comparableVersion = (running: string): string | null => /^\d+\.\d+\.\d+/.exec(running)?.[0] ?? null;

/** The refusal, with the version the repo records and the line it needs, when the running norn does not match it; else null. */
export function versionRefusal(ctx: Context): { failure: CliFailure; repo: string; needs: string } | null {
  // A config with problems is the command's own config error (exit 6), never a version refusal;
  // a command that does not read config (config set) can still fix it
  const loaded = ctx.loaded;
  if (!loaded.ok) return null;
  // `ctx.loaded` is the main checkout's config, never a unit worktree's own team file
  const repo = loaded.config.norn_version;
  if (repo === null) return null;
  const mismatch = versionMismatch(repo, ctx.version);
  if (!mismatch) return null;
  return { failure: refuse(mismatch.error, mismatch.do_instead, "version_mismatch", { repo, running: ctx.version }), repo, needs: mismatch.needs };
}

/** Throws the refusal when the repo records a version the running norn does not match. */
export function guardVersion(ctx: Context): void {
  const refusal = versionRefusal(ctx);
  if (refusal) throw refusal.failure;
}
