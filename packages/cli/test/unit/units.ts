/** Units on the in-memory machine's record, as a tick would have left them, for the agent and person verbs to act on. */
import { newRunState, type RunState } from "@norn/kernel";
import type { ExecScript } from "@norn/conformance";
import { RUN_ENV } from "@norn/plugin-api";
import { encodeLaunchHandle, type RuntimeEnv } from "@norn/runtime";
import { CliContext, configPaths } from "../../src/index.ts";
import { HOME, LOCAL_CONFIG, machine, ROOT, type TestMachine } from "./support.ts";

export const UNIT = "lt-1";
export const RUN = "01JAAAAAAAAAAAAAAAAAAAAAAA";
/** The story workflow's agent step and the gate after it. */
export const AGENT_STEP = "slice";
export const GATE_STEP = "approve-slices";
export const AGENT_OUTCOMES = ["done", "replan"];

/** An agent run's launch env, as the runner sets it. */
export const runEnv = (unit = UNIT, run = RUN): Record<string, string> => ({ [RUN_ENV.unit]: unit, [RUN_ENV.run]: run });

/**
 * A machine with the local config; `env` is the process env the command runs with. Git lists the
 * repo's own checkout as its only worktree, so a unit's worktree has nothing in progress.
 */
export function configured(opts: { env?: Record<string, string>; stdin?: string; script?: ExecScript; revParse?: ExecScript } = {}): TestMachine {
  // the local tracker names its user from the config: no git answers `config user.email` here
  const config = LOCAL_CONFIG.replace("  intake: { label: norn }", "  intake: { label: norn }\n  user: me@box");
  const script: ExecScript = (argv, o) =>
    opts.script?.(argv, o) ?? (argv[0] === "git" && argv[1] === "worktree" && argv[2] === "list" ? { stdout: `worktree ${ROOT}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/main\n\n` } : undefined);
  return machine({ seed: { [configPaths(HOME, ROOT).local]: config }, ...opts, script });
}

/** The same files and git, with another process env: a person's shell beside the agent's. */
export function withEnv(m: TestMachine, env: Record<string, string>, stdin?: string): TestMachine {
  return { ...m, io: { ...m.io, env: { ...m.io.env, ...env }, stdin: async () => stdin ?? "" } };
}

export async function envOf(m: TestMachine): Promise<RuntimeEnv> {
  return new CliContext(m.io).runtimeEnv();
}

/** Commit `unit` in the story workflow at `step`; with `run`, an agent run on the record with a session. */
export async function seedUnit(m: TestMachine, opts: SeedOptions): Promise<RunState> {
  return seedIn(await envOf(m), opts);
}

export interface SeedOptions {
  unit?: string;
  step: string;
  run?: string | null;
  /** fields the state carries beside the step and run, such as a park */
  extra?: Partial<RunState>;
  /** the pack workflow the unit runs; the story workflow when absent */
  workflow?: string;
  /** whether the run on the record was started where a person works beside it */
  attended?: boolean;
}

/** The same, through any runtime env: the integration tier seeds a real machine dir with it. */
export async function seedIn(env: RuntimeEnv, opts: SeedOptions): Promise<RunState> {
  const unit = opts.unit ?? UNIT;
  const name = opts.workflow ?? "story";
  const load = env.workflows[name];
  if (!load?.ok) throw new Error(`the sdlc pack's ${name} workflow does not load`);
  const base = newRunState({ unit, story: unit.split("/")[0] as string, workflow: load.workflow });
  const runId = opts.run === undefined ? RUN : opts.run;
  const state: RunState = {
    ...base,
    ...opts.extra,
    step: opts.step,
    run:
      runId === null
        ? null
        : {
            id: runId,
            step: opts.step,
            attempt: 1,
            started_at: "2026-11-17T10:00:00.000Z",
            executor: "claude",
            attended: opts.attended ?? false,
            nudges: 0,
            session: encodeLaunchHandle({ executor: "claude", unit, run_id: runId, runner: "4242@boot" }),
          },
  };
  const committed = await env.journal.commit(unit, state, null);
  if (!committed.ok) throw new Error(committed.failure.message);
  return state;
}

export async function receiptsOf(m: TestMachine, unit = UNIT) {
  const read = await (await envOf(m)).journal.readUnit(unit);
  if (!read.ok) throw new Error(read.failure.message);
  return read.value.receipts;
}
