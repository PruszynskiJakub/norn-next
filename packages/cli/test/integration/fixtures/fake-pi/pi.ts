/**
 * A stand-in for the `pi` binary (pi-coding-agent 1.5.2), started where norn would start pi: it loads
 * the worktree's project-local extensions the way pi's extension loader does and fires the events
 * pi's agent session fires, in pi's order and with pi's handler semantics, around a scripted model.
 * No model is called. Derived from pi's dist/core/extensions/{loader,runner}.js and
 * dist/core/agent-session.js; keep it faithful to them, as the test proves an extension against it.
 *
 * - Loading: only with `--approve` (print mode cannot ask for project trust, and pi then skips
 *   project resources); `<cwd>/.pi/extensions/*.ts|*.js` and `<cwd>/.pi/extensions/<dir>/index.ts|js`;
 *   the module's default export is the factory, called once with the extension API. The API and the
 *   handler context are strict: a member the fake does not model throws, so an extension that
 *   reaches for one fails the test rather than pass against a fake that is too kind.
 * - Handlers: `emit` catches a handler's throw (pi reports it and goes on); `tool_call` does not
 *   (pi lets it fail the call); `before_agent_start` collects each handler's `message`;
 *   `agent_before_settle` threads `entries` and `continue` through the handlers as a boundary.
 *
 * The model is FAKE_PI_PLAN, a JSON array of steps: `{ "tool": name, "input": {...} }` calls a tool
 * (`bash` runs its command with `sh -c` in the cwd; any other tool is pretended), `{ "settle": text }`
 * ends the run with that assistant text, and `{ "settle": text, "error": message }` ends it on a
 * provider error, which pi never continues (its entries are still committed). A settle the
 * extensions do not continue ends the run, and any steps left are not played. Context an extension
 * steers in with `pi.sendMessage` is kept in `steered`. What happened is printed as one JSON object
 * on stdout.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Handler = (event: Record<string, unknown>, ctx: object) => unknown;
type Step = { tool: string; input: Record<string, unknown> } | { settle: string; error?: string };

const argv = process.argv.slice(2);
const dashes = argv.indexOf("--");
const flags = dashes === -1 ? argv : argv.slice(0, dashes);
const prompt = dashes === -1 ? "" : argv.slice(dashes + 1).join(" ");
const flagValue = (name: string): string | undefined => {
  const i = flags.indexOf(name);
  return i === -1 ? undefined : flags[i + 1];
};
const cwd = process.cwd();
const plan = JSON.parse(process.env.FAKE_PI_PLAN ?? "[]") as Step[];

const report: {
  argv: string[];
  loaded: string[];
  load_errors: string[];
  handler_errors: { event: string; error: string }[];
  injected: unknown[];
  steered: unknown[];
  steps: Record<string, unknown>[];
  unplayed: number;
} = { argv, loaded: [], load_errors: [], handler_errors: [], injected: [], steered: [], steps: [], unplayed: 0 };

function strict<T extends object>(what: string, target: T): T {
  return new Proxy(target, {
    get(t, key) {
      if (typeof key === "symbol" || key in t) return Reflect.get(t, key);
      throw new Error(`fake pi does not model ${what}.${key}`);
    },
  });
}

/** pi's discoverExtensionsInDir: one level, files or a folder's index, no recursion. */
function discover(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isFile() && (name.endsWith(".ts") || name.endsWith(".js"))) found.push(p);
    else if (statSync(p).isDirectory()) {
      const index = ["index.ts", "index.js"].map((f) => join(p, f)).find((f) => existsSync(f));
      if (index) found.push(index);
    }
  }
  return found;
}

const handlers = new Map<string, Handler[]>();

async function load(path: string): Promise<void> {
  try {
    const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
    const factory = mod.default;
    if (typeof factory !== "function") throw new Error(`Extension does not export a valid factory function: ${path}`);
    const api = strict("pi", {
      on(event: string, handler: Handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        return () => handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== handler));
      },
      sendMessage(message: unknown, options: unknown) {
        report.steered.push({ message, options });
      },
    });
    await factory(api);
    report.loaded.push(path);
  } catch (e) {
    report.load_errors.push(e instanceof Error ? e.message : String(e));
  }
}

const sessionId = flagValue("--session-id") ?? randomUUID();
const sessionFile = join(process.env.HOME ?? "/tmp", ".pi", "agent", "sessions", `${sessionId}.jsonl`);
const branch: Record<string, unknown>[] = [];
// the scripted model runs between handlers, so the session is never idle while one is called
let idle = true;
const ctx = strict("ctx", {
  cwd,
  hasUI: false,
  isIdle: () => idle,
  sessionManager: strict("ctx.sessionManager", {
    getSessionId: () => sessionId,
    getSessionFile: () => sessionFile,
    getBranch: () => branch,
  }),
});

async function emit(event: Record<string, unknown>): Promise<void> {
  for (const h of handlers.get(event.type as string) ?? []) {
    try {
      await h(event, ctx);
    } catch (e) {
      report.handler_errors.push({ event: event.type as string, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

async function beforeAgentStart(text: string): Promise<void> {
  for (const h of handlers.get("before_agent_start") ?? []) {
    try {
      const r = (await h({ type: "before_agent_start", messageType: "user", prompt: text, systemPrompt: "", systemPromptOptions: {} }, ctx)) as { message?: unknown } | undefined;
      if (r?.message) report.injected.push(r.message);
    } catch (e) {
      report.handler_errors.push({ event: "before_agent_start", error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** pi's emitToolCall: the first handler result that blocks wins; a throw is not caught. */
async function toolCall(event: Record<string, unknown>): Promise<{ block?: boolean; reason?: string } | undefined> {
  let result: { block?: boolean; reason?: string } | undefined;
  for (const h of handlers.get("tool_call") ?? []) {
    const r = (await h(event, ctx)) as typeof result;
    if (r) {
      result = r;
      if (r.block) return r;
    }
  }
  return result;
}

/** pi's emitBoundary for agent_before_settle: each handler sees the entries and continue so far. */
async function beforeSettle(outcome: "completed" | "error"): Promise<{ entries: unknown[]; continue: boolean }> {
  let entries: unknown[] = [];
  let shouldContinue = false;
  for (const h of handlers.get("agent_before_settle") ?? []) {
    try {
      const r = (await h({ type: "agent_before_settle", outcome, entries, continue: shouldContinue, context: {} }, ctx)) as { entries?: unknown[]; continue?: boolean } | undefined;
      if (r?.entries !== undefined) entries = r.entries;
      if (r?.continue !== undefined) shouldContinue = r.continue;
    } catch (e) {
      report.handler_errors.push({ event: "agent_before_settle", error: e instanceof Error ? e.message : String(e) });
    }
  }
  // an error response is a hard exit: a requested continuation is dropped, the entries are not
  return { entries, continue: outcome === "completed" && shouldContinue };
}

if (flags.includes("--approve")) for (const p of discover(join(cwd, ".pi", "extensions"))) await load(p);

await emit({ type: "session_start", reason: flagValue("--session-id") ? "resume" : "startup" });
await beforeAgentStart(prompt);
idle = false;
branch.push({ type: "message", message: { role: "user", content: [{ type: "text", text: prompt }] } });

let calls = 0;
let settled = false;
for (const [i, step] of plan.entries()) {
  if ("settle" in step) {
    const stop = step.error === undefined ? { stopReason: "stop" } : { stopReason: "error", errorMessage: step.error };
    branch.push({ type: "message", message: { role: "assistant", content: [{ type: "text", text: step.settle }], ...stop } });
    const r = await beforeSettle(step.error === undefined ? "completed" : "error");
    report.steps.push({ settle: step.settle, continue: r.continue, entries: r.entries });
    if (!r.continue) {
      settled = true;
      report.unplayed = plan.length - i - 1;
      break;
    }
    for (const e of r.entries) branch.push(e as Record<string, unknown>);
    continue;
  }
  const toolCallId = `call_${++calls}`;
  let verdict: Awaited<ReturnType<typeof toolCall>>;
  try {
    verdict = await toolCall({ type: "tool_call", toolCallId, toolName: step.tool, input: step.input });
  } catch (e) {
    report.steps.push({ tool: step.tool, threw: e instanceof Error ? e.message : String(e) });
    await emit({ type: "tool_execution_end", toolCallId, toolName: step.tool, result: {}, isError: true });
    continue;
  }
  if (verdict?.block) {
    report.steps.push({ tool: step.tool, blocked: true, reason: verdict.reason });
    await emit({ type: "tool_execution_end", toolCallId, toolName: step.tool, result: {}, isError: true });
    continue;
  }
  if (step.tool === "bash") {
    const r = spawnSync("sh", ["-c", String(step.input.command)], { cwd, encoding: "utf8" });
    report.steps.push({ tool: "bash", blocked: false, code: r.status, stdout: r.stdout, stderr: r.stderr });
    await emit({ type: "tool_execution_end", toolCallId, toolName: "bash", result: {}, isError: r.status !== 0 });
  } else {
    report.steps.push({ tool: step.tool, blocked: false });
    await emit({ type: "tool_execution_end", toolCallId, toolName: step.tool, result: {}, isError: false });
  }
}
if (!settled) report.steps.push({ plan_ran_out: true });
idle = true;
await emit({ type: "agent_settled", aborted: false });
await emit({ type: "session_shutdown", reason: "quit" });
process.stdout.write(`${JSON.stringify(report)}\n`);
