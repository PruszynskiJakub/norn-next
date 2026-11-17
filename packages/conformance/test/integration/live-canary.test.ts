/**
 * The live canary: one real headless turn per harness, its hook calls recorded as the agent made
 * them, then replayed through the harness's normalize and the kernel as the conformance scenarios
 * are. A harness release that renames an event or reshapes a payload shows here as a hook error or
 * a turn that never classifies, long before a unit's session misreads it.
 *
 * It starts a real agent on the person's account and costs money, so it runs only with
 * NORN_TEST_LIVE=1 and is skipped otherwise, CI included.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventsByStep, type HookStep, type Scenario } from "@norn/conformance";
import { claudeHarness } from "@norn/harness-claude";
import { piHarness } from "@norn/harness-pi";
import { classifySession, reduceSession } from "@norn/kernel";
import { type Harness, type HarnessEvent, type HarnessEventOf, type HarnessEventType, isHarnessEvent, markPrompt, RUN_ENV } from "@norn/plugin-api";
import { recorderCommand } from "../unit/recorder.ts";

const LIVE = process.env.NORN_TEST_LIVE === "1";
const TURN_TIMEOUT_MS = 240_000;
const RUN_ID = "run-canary";
const PROMPT_ID = "canary-1";
const PROMPT = markPrompt("Run the shell command `echo norn-canary` exactly once, then reply with the single word: done.", { source: "brief", id: PROMPT_ID });

interface Canary {
  harness: Harness;
  /** extra launch arguments so the one shell call needs no approval in a headless run */
  args: string[];
}

const CANARIES: Canary[] = [
  { harness: claudeHarness, args: ["--allowedTools", "Bash(echo:*)"] },
  // pi runs its built-in tools without an approval step
  { harness: piHarness, args: [] },
];

let root: string;
let worktree: string;
let log: string;

function git(...args: string[]): void {
  const r = Bun.spawnSync(["git", ...args], { cwd: worktree, stdout: "ignore", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "norn-live-canary-")));
  worktree = join(root, "repo");
  mkdirSync(worktree);
  log = join(root, "calls.jsonl");
  git("init", "-q");
  writeFileSync(join(worktree, "README.md"), "canary\n");
  git("add", "README.md");
  git("-c", "user.name=norn", "-c", "user.email=norn@example.invalid", "commit", "-qm", "init");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const ofType =
  <K extends HarnessEventType>(type: K) =>
  (e: HarnessEvent): e is HarnessEventOf<K> =>
    e.type === type;

/** The recorded hook calls of `harness` as a scenario's steps, in the order they arrived. */
function recordedSteps(harness: string): HookStep[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { harness?: string; hook?: string; at: string; payload: unknown })
    .filter((r) => r.harness === harness)
    .map(({ hook, at, payload }) => ({ hook: hook ?? "", at, payload }));
}

describe.skipIf(!LIVE)("live canary", () => {
  test.each(CANARIES.map((c) => [c.harness.name, c] as const))(
    "%s: one real turn normalizes without a hook error and classifies as a finished turn",
    async (name, c) => {
      expect({ name, binary: Bun.which(name) !== null }).toEqual({ name, binary: true });
      await c.harness.install({ worktree, hookCommand: recorderCommand(c.harness.name) });

      const spec = c.harness.launch({
        cwd: worktree,
        prompt: PROMPT,
        run_id: RUN_ID,
        headless: true,
        args: c.args,
        env: { [RUN_ENV.unit]: "canary", NORN_CANARY_LOG: log },
      });
      const proc = Bun.spawn(spec.argv, { cwd: worktree, env: { ...process.env, ...spec.env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => proc.kill("SIGKILL"), TURN_TIMEOUT_MS);
      const exit = await proc.exited;
      clearTimeout(timer);
      const stderr = await new Response(proc.stderr).text();
      expect({ name, exit, stderr: exit === 0 ? "" : stderr }).toEqual({ name, exit: 0, stderr: "" });

      const steps = recordedSteps(name);
      expect({ name, recorded: steps.length > 0, unnamed: steps.filter((s) => s.hook === "").length }).toEqual({ name, recorded: true, unnamed: 0 });
      const s: Scenario = { scenario: `live-${name}`, description: "one real headless turn", run_id: RUN_ID, steps, checks: [] };
      const all = eventsByStep(c.harness, s).flat();
      const last = steps.at(-1)?.at ?? new Date().toISOString();
      const facts = classifySession(reduceSession(all), last, { silentAfterMs: 5 * 60 * 1000 });

      expect({ name, invalid: all.filter((e) => !isHarnessEvent(e)), hookErrors: all.filter((e) => e.type === "hook.error") }).toEqual({ name, invalid: [], hookErrors: [] });
      const brief = all.find(ofType("turn.started"));
      const shell = all.filter(ofType("tool.requested")).find((e) => e.kind === "shell");
      const finished = shell && all.filter(ofType("tool.finished")).find((e) => e.id === shell.id);
      expect({
        name,
        started: all.some(ofType("session.started")),
        brief: brief && { source: brief.source, prompt_id: brief.prompt_id },
        shell: shell !== undefined,
        finished: finished?.ok === true,
        turnEnded: all.some(ofType("turn.ended")),
      }).toEqual({ name, started: true, brief: { source: "brief", prompt_id: PROMPT_ID }, shell: true, finished: true, turnEnded: true });
      expect({ name, activity: ["turn_ended", "ended"].includes(facts.activity), silent: facts.silent, pending_tools: facts.pending_tools, errors: facts.errors }).toEqual({
        name,
        activity: true,
        silent: false,
        pending_tools: 0,
        errors: [],
      });

      await c.harness.uninstall({ worktree });
    },
    TURN_TIMEOUT_MS + 30_000,
  );
});
