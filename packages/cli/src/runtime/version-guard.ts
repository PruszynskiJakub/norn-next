/**
 * gh-61 D2: the one version guard. A command that acts (D1) refuses, exit 3, when the running norn
 * does not match the `norn_version` the main checkout's team file records (B6, B7, B12). It runs in
 * the dispatcher after the repo is located, before the command, so a refused command writes,
 * launches and pushes nothing.
 */
import { versionMismatch } from "@norn/core";
import { versionMatch } from "@norn/schema";
import type { Context } from "../context.ts";
import { refuse } from "../output.ts";

/** The `X.Y.Z` a running version is compared by: a dev or pre-release build (`0.19.0-dev.3`) by its core. */
const comparable = (running: string): string | null => /^\d+\.\d+\.\d+/.exec(running)?.[0] ?? null;

/** Throws the refusal when the repo records a version the running norn does not match. */
export function guardVersion(ctx: Context): void {
  // B3: a config with problems is the command's own config error (exit 6), never a version refusal;
  // a command that does not read config (config set) can still fix it
  const loaded = ctx.loaded;
  if (!loaded.ok) return;
  // B12: `ctx.loaded` is the main checkout's config, never a unit worktree's own team file
  const repo = loaded.config.norn_version;
  const running = comparable(ctx.version);
  if (repo === null || running === null) return; // B5: no key, no check
  const match = versionMatch(repo, running);
  if (match === "match") return;
  const { error, do_instead } = versionMismatch(repo, ctx.version, match);
  throw refuse(error, do_instead, "version_mismatch", { repo, running: ctx.version });
}

