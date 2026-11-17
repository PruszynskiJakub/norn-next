/**
 * The `norn` an agent process runs in these tests, standing in for the CLI until it wraps the
 * runtime: `<setup> hook <harness> <hook>` reads the payload on stdin and prints the hook's answer;
 * `<setup> done <outcome> <report id>`, `ask <question> <report id>` and `stuck <reason> <report id>`
 * report the run named by the launch env; `<setup> brief` prints the brief. A refusal prints the
 * CliError shape and exits 3, as the CLI's machine contract does.
 */
import { tmpdir } from "node:os";
import { parseJson, RUN_ENV } from "@norn/plugin-api";
import { worktreePath } from "@norn/vcs-git";
import { Type } from "@sinclair/typebox";
import { briefOf, createRuntimeEnv, ingestHook, type ReportRequest, reportRun } from "../../../src/index.ts";
import { configOf, hostOf, type MachineSetup, pluginsOf } from "./setup.ts";

const REFUSED = 3;

const [setupPath, verb, ...rest] = process.argv.slice(2);
if (!setupPath || !verb) {
  process.stderr.write("usage: norn-bin <setup> <verb> ...\n");
  process.exit(2);
}
const setupText = await Bun.file(setupPath).text();
const setup = parseJson(Type.Unsafe<MachineSetup>(Type.Object({}, { additionalProperties: true })), setupText, "machine setup");
if (!setup.ok) throw new Error(setup.failure.message);
const ctx = hostOf(setup.value);
const { plugins, harness } = pluginsOf(setupPath, () => {
  throw new Error("the stand-in launches nothing");
});
const built = createRuntimeEnv({ ctx, plugins, config: configOf(setup.value), sessions: { facts: () => null } });
if (!built.ok) throw new Error(built.failure.message);
const env = built.value;

const unit = process.env[RUN_ENV.unit] ?? "";
const runId = process.env[RUN_ENV.run] ?? "";

if (verb === "hook") {
  const [name, hook] = rest as [string, string];
  const payload = parseJson(Type.Unknown(), (await Bun.stdin.text()) || "{}", "hook payload");
  const r = await ingestHook(
    { ctx, harnesses: { [harness.harness.name]: harness.harness }, journal: env.journal, worktreeOf: (u) => worktreePath(ctx, u), writableRoots: [tmpdir()] },
    { harness: name, hook, payload: payload.ok ? payload.value : null, env: process.env },
  );
  process.stdout.write(r.reply.stdout);
  await r.delivered();
  for (const p of r.problems) process.stderr.write(`norn hook: ${p}\n`);
  process.exit(r.reply.exit_code);
}

if (verb === "brief") {
  const shown = await briefOf(env, unit);
  if (!shown.ok) {
    process.stdout.write(`${JSON.stringify(shown.refusal)}\n`);
    process.exit(REFUSED);
  }
  process.stdout.write(shown.value.markdown);
  process.exit(0);
}

const [text, reportId] = rest as [string, string];
const req: ReportRequest | null =
  verb === "done" ? { verb: "done", outcome: text } : verb === "ask" ? { verb: "ask", question: text } : verb === "stuck" ? { verb: "stuck", reason: text } : null;
if (!req) {
  process.stderr.write(`norn-bin: unknown verb ${verb}\n`);
  process.exit(2);
}
const reported = await reportRun(env, unit, runId, req, reportId);
process.stdout.write(`${JSON.stringify(reported.ok ? reported.value : reported.refusal)}\n`);
process.exit(reported.ok ? 0 : REFUSED);
