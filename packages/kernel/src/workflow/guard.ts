/**
 * What of a workflow the person confirms before watch runs a changed file: its person's steps, who
 * stays beside each agent step and what each may do (the role that grants it, and `allow:`). These decide where a person stands and what
 * an agent may do without them, so an agent that edits a repo's workflow cannot lower them unseen; any
 * other change (an instruction, a route, a new step) takes effect as it is.
 */
import type { WorkflowDocument, WorkflowStepDoc } from "./document.ts";

const isPerson = (s: WorkflowStepDoc | undefined): boolean => s !== undefined && Object.hasOwn(s, "gate");

/** `attended:` as a file writes it: the pin keeps `person` as `true` and leaves `none` out. */
const attendance = (s: WorkflowStepDoc): string => (s.attended === true ? "person" : s.attended === "agent" ? "agent" : "none");

/**
 * `allow:` as a file writes it: the pinned list, else an older step's `writes: docs`; a step naming a
 * role without one takes all of its role's capabilities, and an older step writes the worktree.
 */
const allowed = (s: WorkflowStepDoc): string => (s.allow !== undefined ? `[${s.allow.join(", ")}]` : s.writes === "docs" ? "[docs:write]" : s.role !== undefined ? "its role's" : "[code:write]");

/** the role a step names, which grants its capabilities; an older step names none */
const roleOf = (s: WorkflowStepDoc): string => s.role ?? "none";

const agentStep = (s: WorkflowStepDoc | undefined): WorkflowStepDoc | undefined => (s !== undefined && Object.hasOwn(s, "agent") ? s : undefined);

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/**
 * Each change from `before` to `after` the person confirms, in the file's words; empty when none. An
 * agent step that is added or removed counts only when it sets `attended:` or `allow:` away from an
 * agent step's defaults (`none`, the worktree), which hold for every agent step alike.
 */
export function guardChanges(before: WorkflowDocument, after: WorkflowDocument): string[] {
  const out: string[] = [];
  const names = [...new Set([...Object.keys(before.steps), ...Object.keys(after.steps)])];
  for (const name of names) {
    const was = before.steps[name];
    const now = after.steps[name];
    if (isPerson(was) || isPerson(now)) {
      if (!isPerson(now)) out.push(`person step ${name} removed`);
      else if (!isPerson(was)) out.push(`person step ${name} added`);
      else if (canonical(was) !== canonical(now)) out.push(`person step ${name} changed`);
      continue;
    }
    const a = agentStep(was);
    const b = agentStep(now);
    if (a && b) {
      if (roleOf(a) !== roleOf(b)) out.push(`step ${name}: by ${roleOf(a)} → ${roleOf(b)}`);
      if (attendance(a) !== attendance(b)) out.push(`step ${name}: attended ${attendance(a)} → ${attendance(b)}`);
      if (allowed(a) !== allowed(b)) out.push(`step ${name}: allow ${allowed(a)} → ${allowed(b)}`);
      continue;
    }
    const only = a ?? b;
    const set = only ? [attendance(only) !== "none" && `attended ${attendance(only)}`, (only.writes === "docs" || only.allow !== undefined) && `allow ${allowed(only)}`].filter(Boolean) : [];
    if (set.length > 0) out.push(`step ${name} ${a ? "removed" : "added"}: ${set.join(", ")}`);
  }
  return out;
}
