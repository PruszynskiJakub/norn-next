/**
 * Running a dashboard button: the real command a person types, in the lab's repo with the lab's own
 * norn home, through the host's exec (the one IO boundary), norn itself on this same build. Reset is
 * `norn lab --clean`, done in process as the command does it.
 */
import { CHILD_TIMEOUT_MS, labEnv, labMarkdown, type LabRun, openLab } from "./lab.ts";
import { commandText, type LabActAnswer, type LabActionName, type LabCommand } from "./dashboard.ts";

/** The longest output a button answers with: its tail, where a command says how it went. */
export const ACT_OUTPUT_MAX = 8000;

const tail = (text: string): string => (text.length > ACT_OUTPUT_MAX ? `…${text.slice(-ACT_OUTPUT_MAX)}` : text);

export async function runLabCommand(lab: LabRun, name: LabActionName, command: LabCommand): Promise<LabActAnswer> {
  const shown = commandText(command);
  if (command.kind === "reset") {
    const view = await openLab(lab, { clean: true });
    return { action: name, command: shown, exit: 0, output: labMarkdown(view) };
  }
  const argv = command.kind === "norn" ? [...lab.self, ...command.args] : ["sh", "-c", command.line];
  const r = await lab.host.exec(argv, { cwd: lab.paths.repo, env: labEnv(lab.paths), timeoutMs: CHILD_TIMEOUT_MS });
  return { action: name, command: shown, exit: r.code, output: tail([r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n")) };
}
