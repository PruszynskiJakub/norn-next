/**
 * The rule behind `Command.personOnly`: such a command is refused in an agent's session. The session
 * is known by the launch env every launch carries (`RUN_ENV`), which every process the agent starts
 * inherits, so an agent cannot run the command through any shell of its own. A person typing in an
 * attended step's pane goes through that same shell; they run it from a shell of their own instead.
 */
import { RUN_ENV } from "@norn/plugin-api";
import type { Command } from "./command.ts";
import { type CliFailure, refuse } from "./output.ts";

/** The run an agent's session works for, or null outside one. A blank value is unset (doctor probes hooks with blanks). */
export function agentSessionOf(env: Readonly<Record<string, string | undefined>>): { unit?: string; run?: string } | null {
  const unit = env[RUN_ENV.unit]?.trim();
  const run = env[RUN_ENV.run]?.trim();
  if (!unit && !run) return null;
  return { ...(unit && { unit }), ...(run && { run }) };
}

export function personOnlyRefusal(c: Command, env: Readonly<Record<string, string | undefined>>): CliFailure | null {
  if (!c.personOnly) return null;
  const session = agentSessionOf(env);
  if (!session) return null;
  const of = [session.unit && `unit ${session.unit}`, session.run && `run ${session.run}`].filter(Boolean).join(", ");
  return refuse(
    `norn ${c.name} is a person's command, and this process runs in an agent's session (${of})`,
    `ask the person: norn ask "<what you need them to run, and why>". A person runs norn ${c.name} from their own shell, where ${RUN_ENV.unit} and ${RUN_ENV.run} are not set, not from the agent's pane`,
    "person_only",
  );
}
