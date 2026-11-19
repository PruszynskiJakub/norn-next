/**
 * What a unit's ended runs left open on this machine (a herdr pane per run, and with the last one the
 * story's workspace), closed once the unit is done with: at the story's finish and by `norn tidy`.
 * Only runs the unit's record started are closed, each through the launcher that knows what its own
 * start opened, so a pane norn did not launch is never touched.
 */
import type { RuntimeEnv } from "./env.ts";

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** How many of the unit's runs had something to close; a failure is a problem, never a stop. */
export async function closeUnitRuns(env: RuntimeEnv, unit: string): Promise<{ closed: number; problems: string[] }> {
  const close = env.launcher.close?.bind(env.launcher);
  if (!close) return { closed: 0, problems: [] };
  const read = await env.journal.readUnit(unit);
  if (!read.ok) return { closed: 0, problems: [`${unit}: panes: its record could not be read, so its runs' panes stay: ${read.failure.message}`] };
  // a live run is its step's, never closed here
  if (read.value.state?.ended === undefined) return { closed: 0, problems: [] };
  const handles = new Set<string>();
  for (const r of read.value.receipts) if (r.data.kind === "run.started" && r.data.run_kind === "agent" && r.data.session !== undefined) handles.add(r.data.session);
  let closed = 0;
  const problems: string[] = [];
  for (const handle of handles) {
    try {
      const done = await close(handle);
      if (!done.ok) problems.push(`${unit}: closing ${handle}: ${done.failure.message}`);
      else if (done.value) closed++;
    } catch (e) {
      problems.push(`${unit}: closing ${handle}: ${message(e)}`);
    }
  }
  return { closed, problems };
}
