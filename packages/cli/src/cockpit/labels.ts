/**
 * The `$norn` sidebar token of each story's workspace, written by `status --segment` and the cockpit
 * while they run inside herdr. Presentation only: a runner that cannot write one is left alone.
 */
import type { RuntimeEnv } from "@norn/runtime";
import type { ProjectView } from "../views.ts";
import { finished } from "./groups.ts";
import { storyToken } from "./segment.ts";

/** Inside herdr, or a command herdr runs itself (a tab bar segment, where only the socket is set). */
export const insideHerdr = (env: Readonly<Record<string, string | undefined>>): boolean => env.HERDR_ENV === "1" || !!env.HERDR_SOCKET_PATH;

/** Each unfinished story's `$norn` token on its runs' workspace; a runner that cannot is left alone, as this is presentation only. */
export async function labelStories(env: RuntimeEnv, view: ProjectView, ttlMs: number): Promise<number> {
  if (!env.launcher.label) return 0;
  let shown = 0;
  for (const s of view.stories) {
    if (finished(s)) continue;
    const r = await env.launcher.label(s.key, storyToken(view, s.key), ttlMs).catch(() => null);
    if (r?.ok && r.value) shown++;
  }
  return shown;
}
