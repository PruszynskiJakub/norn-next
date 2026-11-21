/**
 * The rule behind `Command.personOnly`: such a command is refused in an agent's session. Every launch
 * marks the agent's process with the launch env (`RUN_ENV`), which every process it starts inherits.
 * Two signals read that mark:
 * - this process's own env, which a shell can clear (`env -u NORN_UNIT …`), so it alone stops only
 *   an agent that does not try;
 * - the env each ancestor process was started with, which no descendant can rewrite: an agent that
 *   clears its own env still runs below the agent process the launch marked.
 * Neither reaches a process the agent detached from its own tree (one reparented to init), nor a
 * write to the store that bypasses the CLI: only an OS sandbox closes those (docs/limitations.md).
 * A person typing in an attended step's pane goes through the agent's own shell; they run the
 * command from a shell of their own instead.
 */
import { RUN_ENV } from "@norn/plugin-api";
import type { Command } from "./command.ts";
import { type CliFailure, refuse } from "./output.ts";
import type { AncestorProcess } from "./wiring.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The run an agent's session works for, or null outside one. A blank value is unset (doctor probes hooks with blanks). */
export function agentSessionOf(env: Env): { unit?: string; run?: string } | null {
  const unit = env[RUN_ENV.unit]?.trim();
  const run = env[RUN_ENV.run]?.trim();
  if (!unit && !run) return null;
  return { ...(unit && { unit }), ...(run && { run }) };
}

export interface PersonOnlyProbe {
  env: Env;
  /** the host's read of this process's ancestry; absent where there is no process tree to read */
  ancestry?(names: readonly string[]): Promise<AncestorProcess[]>;
}

const ASK = 'ask the person: norn ask "<what you need them to run, and why>"';

const refusal = (c: Command, where: string): CliFailure =>
  refuse(
    `norn ${c.name} is a person's command, and this process runs in an agent's session (${where})`,
    `${ASK}. A person runs norn ${c.name} from their own shell, not from the agent's pane`,
    "person_only",
  );

const named = (s: { unit?: string; run?: string }): string => [s.unit && `unit ${s.unit}`, s.run && `run ${s.run}`].filter(Boolean).join(", ");

export async function personOnlyRefusal(c: Command, probe: PersonOnlyProbe): Promise<CliFailure | null> {
  if (!c.personOnly) return null;
  const own = agentSessionOf(probe.env);
  if (own) return refusal(c, named(own));
  if (!probe.ancestry) return null;
  let ancestors: AncestorProcess[];
  try {
    ancestors = await probe.ancestry([RUN_ENV.unit, RUN_ENV.run]);
  } catch (e) {
    // an ancestry that cannot be read could hide the agent's process, so it is never taken for a person's shell
    return refuse(
      `norn ${c.name} is a person's command, and whether this process runs in an agent's session could not be read: ${e instanceof Error ? e.message : String(e)}`,
      `a person runs norn ${c.name} from their own shell once the process list can be read (ps, or /proc on Linux); an agent must ${ASK}`,
      "person_only",
    );
  }
  for (const a of ancestors) {
    const session = a.env ? agentSessionOf(a.env) : null;
    if (session) return refusal(c, `${named(session)}, through ancestor process ${a.pid}`);
  }
  return null;
}
