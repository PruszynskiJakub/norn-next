/**
 * Running a dashboard button: the real command a person types, in the lab's repo with the lab's own
 * norn home, through the host's exec (the one IO boundary), norn itself on this same build. Reset is
 * `norn lab --clean`, done in process as the command does it. A break-it switch runs the shell line
 * planned from the lab as it is now, and answers with the way out.
 */
import { planBreak } from "./break-it.ts";
import { CHILD_TIMEOUT_MS, labEnv, labMarkdown, type LabRun, type LabView, openLab } from "./lab.ts";
import { commandText, type LabActAnswer, type LabActionName, type LabCommand } from "./dashboard.ts";

/** The longest output a button answers with: its tail, where a command says how it went. */
export const ACT_OUTPUT_MAX = 8000;

const tail = (text: string): string => (text.length > ACT_OUTPUT_MAX ? `…${text.slice(-ACT_OUTPUT_MAX)}` : text);

/** Reset: the lab removed and built again, and the lab as it now is. */
export async function resetLab(lab: LabRun, name: LabActionName): Promise<{ answer: LabActAnswer; view: LabView }> {
  const command: LabCommand = { kind: "reset" };
  const view = await openLab(lab, { clean: true });
  return { answer: { action: name, command: commandText(command), exit: 0, output: labMarkdown(view), way_out: null }, view };
}

export async function runLabCommand(lab: LabRun, name: LabActionName, command: LabCommand): Promise<LabActAnswer> {
  if (command.kind === "reset") return (await resetLab(lab, name)).answer;
  const env = labEnv(lab.paths);
  const plan = command.kind === "break" ? await planBreak({ ...lab, env }, command.name, command.key) : null;
  const shown = plan?.line ?? commandText(command);
  const argv = command.kind === "norn" ? [...lab.self, ...command.args] : ["sh", "-c", shown];
  const r = await lab.host.exec(argv, { cwd: lab.paths.repo, env, timeoutMs: CHILD_TIMEOUT_MS });
  return { action: name, command: shown, exit: r.code, output: tail([r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n")), way_out: plan?.way_out ?? null };
}
