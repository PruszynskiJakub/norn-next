/**
 * Reading the lab for its dashboard: read only, in process, through a CLI context set on the lab's
 * repo and its own norn home, so it sees what `norn status` there sees and nothing of the person's.
 * Every read goes through that context's host and store, and each trace is validated before use.
 */
import { parseJson } from "@norn/plugin-api";
import { HANDOFFS_DIR, listStoryDocs, readStoryDoc, type RuntimeEnv, SPEC_ARTIFACT, sessionLogPath, TRACE_DIR } from "@norn/runtime";
import { Type } from "@sinclair/typebox";
import { CliContext, type CliIo } from "../context.ts";
import { refuse } from "../output.ts";
import { loadProjectView } from "../views.ts";
import type { LabSources, LabTrace } from "./dashboard.ts";
import { placeInBeat } from "./lab.ts";
import type { LabPaths } from "./paths.ts";
import { labScript } from "./script.ts";

/** How many of the newest tick traces the decisions panel reads. */
export const TRACES_READ = 60;
/** The pull request body the describe step writes beside the spec. */
export const PR_BODY = "pr.md";
/** The longest session log shown: its tail, where the session is now. */
export const SESSION_TAIL = 12_000;

const Trace = Type.Object({
  tick_id: Type.String({ minLength: 1 }),
  at: Type.String({ minLength: 1 }),
  outcomes: Type.Array(
    Type.Object({
      decision: Type.Object({ rule: Type.String({ minLength: 1 }), kind: Type.String({ minLength: 1 }), unit: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
      ok: Type.Boolean(),
      error: Type.Optional(Type.String()),
    }),
  ),
});

/** A CLI context over the lab, as a person's shell in the lab's repo with its norn home would be. */
export function labContext(io: CliIo, paths: LabPaths): CliContext {
  return new CliContext({ ...io, cwd: paths.repo, env: { ...io.env, NORN_HOME_DIR: paths.home } });
}

async function traces(env: RuntimeEnv): Promise<LabTrace[]> {
  const dir = `${env.ctx.repo.dataDir}/${TRACE_DIR}`;
  const names = (await env.ctx.files.list(dir)).filter((n) => n.endsWith(".json")).sort().slice(-TRACES_READ);
  const out: LabTrace[] = [];
  for (const name of names) {
    const text = await env.ctx.files.read(`${dir}/${name}`);
    if (text === null) continue;
    const r = parseJson(Trace, text, name);
    // a trace is a record for people: one that does not read is left off the panel, never guessed at
    if (r.ok) out.push(r.value);
  }
  return out;
}

async function docs(env: RuntimeEnv, key: string): Promise<{ path: string; text: string }[]> {
  const handoffs = await listStoryDocs(env, key, HANDOFFS_DIR);
  const paths = [SPEC_ARTIFACT, ...(handoffs.ok ? handoffs.value : []), PR_BODY];
  const out: { path: string; text: string }[] = [];
  for (const path of paths) {
    const r = await readStoryDoc(env, key, path);
    if (r.ok && r.value !== null) out.push({ path, text: r.value });
  }
  return out;
}

type Receipts = NonNullable<LabSources["record"]>["receipts"];

/** The newest agent run of the unit and what its session wrote to its log. */
async function session(env: RuntimeEnv, receipts: Receipts): Promise<LabSources["session"]> {
  for (let i = receipts.length - 1; i >= 0; i--) {
    const d = receipts[i]?.data as { kind?: unknown; run_kind?: unknown; run_id?: unknown; executor?: unknown };
    if (d.kind !== "run.started" || d.run_kind !== "agent" || typeof d.run_id !== "string") continue;
    const log = (await env.ctx.files.read(sessionLogPath(env.ctx, d.run_id))) ?? "";
    return { run: d.run_id, executor: typeof d.executor === "string" ? d.executor : "-", log: log.length > SESSION_TAIL ? `…${log.slice(-SESSION_TAIL)}` : log };
  }
  return null;
}

/** Everything the dashboard shows, read from the lab once. */
export async function readLab(io: CliIo, paths: LabPaths): Promise<LabSources> {
  const ctx = labContext(io, paths);
  const env = await ctx.runtimeEnv();
  const script = labScript();
  const load = env.workflows[script.workflow];
  if (load === undefined || !load.ok) throw refuse(`the lab's workflow ${script.workflow} does not load`, "norn lab --clean", "lab_failed");
  const project = await loadProjectView(env);
  const story = project.stories[0] ?? null;
  const key = story?.key ?? project.intake[0]?.key ?? null;
  const unit = story?.units.find((u) => u.id === story.key) ?? story?.units[0] ?? null;
  const read = story === null ? null : await env.journal.readUnit(story.key);
  const record = read?.ok ? { receipts: read.value.receipts, state: read.value.state === null || read.value.version === null ? null : { version: read.value.version, data: read.value.state } } : null;
  return {
    view: placeInBeat(paths, false, key, unit),
    workflow: { name: script.workflow, loaded: load.workflow },
    story,
    record,
    traces: await traces(env),
    docs: story === null ? [] : await docs(env, story.key),
    session: record === null ? null : await session(env, record.receipts),
  };
}
