/**
 * The remote's labels against the ones norn uses. `create` (init, upgrade) makes
 * each missing one; without it (doctor) they are only listed. Never edits or deletes a label,
 * and never throws for the remote's sake: no git remote, a missing or logged-out CLI or a failed call
 * comes back as `checked: false` with the reason, a failed create as `not_created`
 * with its command. A tick never calls this.
 */
import { cmd, labelCreateCommand, labelDeleteCommand, NORN_LABEL_COLOR, type PortError, planLabels, type RemotePort, type RepoWorkflows, WF_LABEL } from "@norn/core";
import { oneLine } from "@norn/view";

export interface LabelsChecked {
  checked: true;
  /** created by this run (create mode only) */
  created: string[];
  /** already on the remote, left as they are */
  existing: string[];
  /** check mode: on the remote's list of wanted labels but absent, with the command that creates each */
  missing: Array<{ name: string; command: string }>;
  /** create mode: not created, why, and what to run */
  not_created: Array<{ name: string; reason: string; command: string }>;
  /** `norn:wf:*` labels naming no workflow, with the delete command norn never runs */
  unused: Array<{ name: string; command: string }>;
}

export interface LabelsNotChecked {
  checked: false;
  reason: string;
  /** the command that fixes the cause (`gh auth login`), null when there is none to name */
  fix: string | null;
  /** what a person does for labels to be checked, for init's and upgrade's report */
  do_instead: string | null;
}

export type LabelsReport = LabelsChecked | LabelsNotChecked;

const notChecked = (e: unknown, cli: string): LabelsNotChecked => {
  const err = e as PortError;
  const code = typeof err.code === "string" ? err.code : "";
  if (code.endsWith("_missing")) return { checked: false, reason: `${cli} is not installed`, fix: `install ${cli}`, do_instead: `install ${cli}, then run ${cmd.upgrade()}` };
  if (code.endsWith("_auth")) return { checked: false, reason: `${cli} is not logged in`, fix: `${cli} auth login`, do_instead: `run ${cli} auth login, then ${cmd.upgrade()}` };
  return { checked: false, reason: oneLine(err.message ?? String(e), Infinity), fix: null, do_instead: `run ${cmd.upgrade()} again` };
};

export async function remoteLabels(opts: { remote: RemotePort | null; gitRemoteUrl: string | null; intake: string; workflows: RepoWorkflows; create: boolean }): Promise<LabelsReport> {
  // A local-only repo has nothing to label
  if (!opts.gitRemoteUrl || !opts.remote) return { checked: false, reason: "no git remote", fix: null, do_instead: null };
  const remote = opts.remote;
  const cli = remote.provider;
  let names: string[];
  try {
    names = (await remote.listLabels()).map((l) => l.name);
  } catch (e) {
    return notChecked(e, cli);
  }
  const workflows = Object.values(opts.workflows).map((w) => ({ name: w.name, valid: w.workflow !== null && w.issues.length === 0, ...(w.workflow?.description ? { description: w.workflow.description } : {}) }));
  const plan = planLabels({ intake: opts.intake, workflows, remote: names });
  const unused = plan.unused.map((name) => ({ name, command: labelDeleteCommand(cli, name) }));
  const label = (l: { name: string; description: string }) => ({ ...l, color: NORN_LABEL_COLOR });
  if (!opts.create) return { checked: true, created: [], existing: plan.existing, missing: plan.missing.map((l) => ({ name: l.name, command: labelCreateCommand(cli, label(l)) })), not_created: [], unused };

  const created: string[] = [];
  const existing = [...plan.existing];
  const not_created: LabelsChecked["not_created"] = [];
  for (const l of plan.missing) {
    try {
      await remote.createLabel(label(l));
      created.push(l.name);
    } catch (e) {
      const code = String((e as PortError).code ?? "");
      // a label beyond the listed page, or made meanwhile: there now, never restyled
      if (code.endsWith("_exists")) existing.push(l.name);
      else not_created.push({ name: l.name, reason: code.endsWith("_auth") ? "permission denied" : oneLine((e as Error).message ?? String(e), Infinity), command: labelCreateCommand(cli, label(l)) });
    }
  }
  // A workflow that fails validation gets no label
  for (const w of plan.invalid) not_created.push({ name: `${WF_LABEL}${w}`, reason: `workflow ${w} is invalid`, command: cmd.doctor() });
  return { checked: true, created, existing, missing: [], not_created, unused };
}

/** init's and upgrade's labels lines: what was created, already there, unused and not created. */
export function labelsLines(r: LabelsReport): string[] {
  if (!r.checked) return [`labels: not checked — ${r.reason}${r.do_instead ? `: ${r.do_instead}` : ""}`];
  const out = [`labels: ${[r.created.length ? `created ${r.created.join(", ")}` : "", r.existing.length ? `${r.existing.length} already there` : ""].filter(Boolean).join("; ") || "none"}`];
  for (const n of r.not_created) out.push(`  ${n.name} not created: ${n.reason} — \`${n.command}\``);
  for (const u of r.unused) out.push(`  ${u.name} unused (names no workflow) — delete it yourself if no issue needs it: \`${u.command}\``);
  return out;
}

/** doctor's warnings for labels: never a failed check. */
export function labelsWarnings(r: LabelsReport): string[] {
  if (!r.checked) return [`labels not checked: ${r.reason}${r.fix ? ` (${r.fix})` : ""}`];
  return [
    ...r.missing.map((m) => `label ${m.name} is missing on the remote: run \`${cmd.upgrade()}\``),
    ...r.unused.map((u) => `label ${u.name} is unused (names no workflow): \`${u.command}\` deletes it`),
  ];
}
