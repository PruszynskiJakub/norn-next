/**
 * The herdr runner: one herdr workspace per story (labelled with the request's `workspace`), one tab
 * per run labelled with its title, the agent started in the tab's pane with the launch env. A person
 * can watch and type, `send` types text and submits it, `keys` presses keys in the pane, as a
 * dialog there takes them, and `dialog` reads one while herdr reports the agent blocked on it. The
 * handle is herdr's pane id. `stop` ends the agent and leaves its tab: herdr closes a workspace with
 * its last pane, so closing each run's pane would give every run of a story a workspace of its own.
 *
 * `start` is idempotent by key. The key's record (`<dataDir>/runners/herdr/<key>.json`) is made with
 * `ctx.files.create` before any pane is opened, holding no pane yet; it names the pane once one is
 * opened and is marked `ran` once the agent's command went in:
 * - a record that `ran` hands back its pane, alive or not: a key is one run, and a run that died is
 *   for the host to see as died, never to restart under the same key;
 * - a record with a pane that has not `ran` (a crash between the two) sends the command into its pane;
 * - a record with no pane (a crash between opening the pane and naming it) adopts a tab of the story's
 *   workspace labelled with the title whose pane holds nothing but its shell, so a replay neither opens
 *   a second tab nor ever takes over a pane where some agent still works;
 * - no record is a fresh start, which always opens its own tab: an idle tab with the same title is
 *   another run's (an earlier attempt's, a person's), never this one's.
 * Two starts racing for one key: the one whose record lands first goes on, the other opens nothing.
 */
import { fail, type HostContext, ok, parseJson, type PluginResult, type Runner, type RunnerCapabilities, type RunnerStartRequest } from "@norn/plugin-api";
import { type Static, Type } from "@sinclair/typebox";
import { type HerdrCall, herdrCaller, herdrErrorCode, herdrJson, shellJoin } from "./call.ts";
import { DEFAULT_START_WAIT_MS, type HerdrConfig } from "./config.ts";

export const RUNNER_NAME = "herdr";

// a pane runs its agent whether or not anyone watches it, so auto mode starts agents here as well
export const HERDR_CAPABILITIES: RunnerCapabilities = Object.freeze({ attended: true, headless: true, paneInput: true });

/** What a start under one key made, so a replay finds it. */
export const HerdrKeyRecord = Type.Object(
  {
    key: Type.String(),
    /** herdr's workspace id */
    workspace: Type.Optional(Type.String()),
    /** absent until the pane is open: a record without one is a start that may have opened it */
    pane: Type.Optional(Type.String()),
    title: Type.String(),
    /** the agent's command went into the pane */
    ran: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type HerdrKeyRecord = Static<typeof HerdrKeyRecord>;

export function keyRecordPath(ctx: HostContext, key: string): string {
  return `${ctx.repo.dataDir}/runners/herdr/${key}.json`;
}

/** The script a start types into its pane, beside its key record. */
export function launchScriptPath(ctx: HostContext, key: string): string {
  return `${ctx.repo.dataDir}/runners/herdr/${key}.sh`;
}

/**
 * The command as a script the pane runs with one short line: `pane run` goes through the terminal's
 * line input, which caps a line (1024 bytes on macOS) far below a launch with its env and brief.
 * `exec`, so the agent itself holds the pane's foreground.
 */
export function launchScript(argv: readonly string[]): string {
  return `#!/bin/sh\n# a norn launch, run in its herdr pane\nexec ${shellJoin(argv)}\n`;
}

/** A key becomes a file name, so it may not climb out of the runner's folder. */
const SAFE_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/** How often a start looks whether the agent took the pane's foreground. */
const START_POLL_MS = 250;
/** How long a stop waits for the agent to leave on TERM before it kills it. */
const STOP_WAIT_MS = 3_000;
/** How much of the pane a failed start quotes. */
const SCREEN_LINES = 30;

export interface HerdrDeps {
  /** waits between a start's looks at the pane; a test passes one that returns at once */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// herdr's answers, only the fields the runner reads; herdr may add others
const WorkspaceList = Type.Object({ result: Type.Object({ workspaces: Type.Array(Type.Object({ workspace_id: Type.String(), label: Type.Optional(Type.String()) })) }) });
const TabList = Type.Object({ result: Type.Object({ tabs: Type.Array(Type.Object({ tab_id: Type.String(), label: Type.Optional(Type.String()) })) }) });
const PaneList = Type.Object({ result: Type.Object({ panes: Type.Array(Type.Object({ pane_id: Type.String(), tab_id: Type.Optional(Type.String()) })) }) });
const RootPane = Type.Object({ pane_id: Type.String(), tab_id: Type.Optional(Type.String()), workspace_id: Type.Optional(Type.String()) });
const Created = Type.Object({ result: Type.Object({ root_pane: RootPane, tab: Type.Optional(Type.Object({ tab_id: Type.Optional(Type.String()) })) }) });
const MaybeId = Type.Optional(Type.Union([Type.Integer(), Type.Null()]));
const ProcessInfoAnswer = Type.Object({ result: Type.Object({ process_info: Type.Object({ foreground_process_group_id: MaybeId, shell_pid: MaybeId }) }) });
type ProcessInfo = Static<typeof ProcessInfoAnswer>["result"]["process_info"];
const PaneInfo = Type.Object({ result: Type.Object({ pane: Type.Object({ agent_status: Type.Optional(Type.String()) }) }) });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isGone = (r: PluginResult<unknown>) => !r.ok && r.failure.code === "not_found";

/** Something other than the pane's shell holds its foreground: the agent (or whatever it started). */
function busy(info: ProcessInfo | null): boolean {
  const fg = info?.foreground_process_group_id;
  return typeof fg === "number" && fg > 0 && fg !== info?.shell_pid;
}

/** The last non-blank lines of a pane screen, joined for one message line. */
function lastLines(screen: string, n: number): string {
  return screen
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .slice(-n)
    .join(" | ");
}

/** How many lines of a dialog it hands back: enough for its question and options, never the whole screen. */
const DIALOG_LINES = 16;
const DIALOG_CHARS = 1200;
/** The frame a dialog is drawn in, which says nothing a person answers. */
const FRAME = /[\u2500-\u257f]/g;

/**
 * A dialog's lines off the pane's screen, its frame dropped. One blank line is kept between blocks,
 * as it is what sets a dialog's options apart from its question and its footer.
 */
export function dialogText(screen: string): string {
  const lines: string[] = [];
  for (const raw of screen.split("\n")) {
    const line = raw.replace(FRAME, " ").trimEnd();
    if (line.trim() !== "") lines.push(line);
    else if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
  }
  const kept = lines.slice(-DIALOG_LINES);
  while (kept[0] === "") kept.shift();
  while (kept.at(-1) === "") kept.pop();
  const text = kept.join("\n");
  return text.length > DIALOG_CHARS ? text.slice(-DIALOG_CHARS) : text;
}

/**
 * The command with the launch env on it, in every pane. One this start did not open may hold an
 * earlier run's env, and a hook reading that run's id would file this run's events under it; and in
 * one it opened, the shell's own startup files run after `--env` and may put PATH back in their own
 * order, so the `norn` the agent runs would be another build than the one that launched it.
 */
function withEnv(req: RunnerStartRequest): string[] {
  const env = Object.entries(req.env);
  return env.length === 0 ? req.argv : ["env", ...env.map(([k, v]) => `${k}=${v}`), ...req.argv];
}

export function createHerdrRunner(ctx: HostContext, config: HerdrConfig, deps: HerdrDeps = {}): Runner {
  const herdr: HerdrCall = herdrCaller(ctx, config);
  const startWaitMs = config.start_wait_ms ?? DEFAULT_START_WAIT_MS;
  const sleep = deps.sleep ?? realSleep;

  async function readRecord(path: string): Promise<PluginResult<HerdrKeyRecord | null>> {
    let text: string | null;
    try {
      text = await ctx.files.read(path);
    } catch (e) {
      return fail("unavailable", `herdr runner: cannot read ${path}: ${message(e)}`);
    }
    if (text === null) return ok(null);
    const rec = parseJson(HerdrKeyRecord, text, path);
    // a record no start wrote is never guessed at: starting over could put a second agent on the run
    return rec.ok ? rec : fail("invalid", `herdr runner: ${path} is not a key record; remove it to start the run again`, false);
  }

  /** The pane's process info, null when the pane is gone. */
  async function processInfo(pane: string): Promise<PluginResult<ProcessInfo | null>> {
    const r = await herdrJson(herdr, ["pane", "process-info", "--pane", pane], ProcessInfoAnswer);
    if (isGone(r)) return ok(null);
    return r.ok ? ok(r.value.result.process_info) : r;
  }

  async function findWorkspace(label: string): Promise<PluginResult<string | null>> {
    const r = await herdrJson(herdr, ["workspace", "list"], WorkspaceList);
    return r.ok ? ok(r.value.result.workspaces.find((w) => w.label === label)?.workspace_id ?? null) : r;
  }

  /** The one idle pane of a tab labelled `title` in the workspace, for a replay whose record names no pane. */
  async function findIdlePane(workspace: string, title: string): Promise<PluginResult<string | null>> {
    const tabs = await herdrJson(herdr, ["tab", "list", "--workspace", workspace], TabList);
    if (!tabs.ok) return isGone(tabs) ? ok(null) : tabs;
    const tabIds = new Set(tabs.value.result.tabs.filter((t) => t.label === title).map((t) => t.tab_id));
    if (tabIds.size === 0) return ok(null);
    const panes = await herdrJson(herdr, ["pane", "list", "--workspace", workspace], PaneList);
    if (!panes.ok) return isGone(panes) ? ok(null) : panes;
    for (const p of panes.value.result.panes) {
      if (!p.tab_id || !tabIds.has(p.tab_id)) continue;
      const info = await processInfo(p.pane_id);
      if (!info.ok) return info;
      if (info.value !== null && !busy(info.value)) return ok(p.pane_id);
    }
    return ok(null);
  }

  /** A new tab (or, for a story's first run, a new workspace) labelled with the title. */
  async function openPane(req: RunnerStartRequest, workspace: string | null): Promise<PluginResult<{ workspace: string; pane: string }>> {
    const envFlags = Object.entries(req.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
    const common = ["--cwd", req.cwd, ...envFlags, "--no-focus"];
    const label = req.workspace ?? req.title;
    const r = await herdrJson(herdr, workspace ? ["tab", "create", "--workspace", workspace, "--label", req.title, ...common] : ["workspace", "create", "--label", label, ...common], Created);
    if (!r.ok) return r;
    const created = r.value.result;
    const pane = created.root_pane.pane_id;
    const ws = created.root_pane.workspace_id ?? workspace;
    if (!ws) return closeAfter(pane, fail("unknown", "herdr workspace create did not say which workspace it made", false));
    const tab = created.root_pane.tab_id ?? created.tab?.tab_id;
    // a new workspace's first tab is labelled by herdr; the run's title on it is what a replay looks for
    if (!workspace && tab && label !== req.title) {
      const renamed = await herdr(["tab", "rename", tab, req.title]);
      if (!renamed.ok) return closeAfter(pane, renamed);
    }
    return ok({ workspace: ws, pane });
  }

  async function closePane(pane: string): Promise<PluginResult<void>> {
    const closed = await herdr(["pane", "close", pane]);
    return closed.ok || isGone(closed) ? ok(undefined) : closed;
  }

  async function closeAfter<T>(pane: string, failure: PluginResult<T>): Promise<PluginResult<T>> {
    await herdr(["pane", "close", pane]);
    return failure;
  }

  /** Type the command into the pane and wait for it to take the foreground. */
  async function runIn(pane: string, argv: string[]): Promise<PluginResult<void>> {
    const ran = await herdr(["pane", "run", pane, shellJoin(argv)]);
    if (!ran.ok) return ran;
    // `pane run` acknowledges admission only: a command cut off while the shell started never ran
    for (let waited = 0; ; waited += START_POLL_MS) {
      const info = await processInfo(pane);
      if (!info.ok) return info;
      if (info.value === null) return fail("unavailable", `herdr pane ${pane} closed while the agent started`);
      if (busy(info.value)) return ok(undefined);
      if (waited >= startWaitMs) break;
      await sleep(START_POLL_MS);
    }
    const screen = await herdr(["pane", "read", pane, "--source", "visible", "--lines", String(SCREEN_LINES)]);
    const shown = screen.ok ? lastLines(screen.value, 5) : "";
    return fail("unavailable", `the command never started in herdr pane ${pane} (nothing took the foreground within ${startWaitMs / 1000}s)${shown ? `; the pane showed: ${shown}` : ""}`);
  }

  async function writeRecord(path: string, rec: HerdrKeyRecord): Promise<PluginResult<void>> {
    try {
      await ctx.files.write(path, `${JSON.stringify(rec)}\n`);
      return ok(undefined);
    } catch (e) {
      return fail("unavailable", `herdr runner: cannot record ${path}: ${message(e)}`);
    }
  }

  /** Run the command in a recorded pane, then mark the record; a failed run removes both so a retry starts clean. */
  async function finish(path: string, rec: HerdrKeyRecord & { pane: string }, argv: string[]): Promise<PluginResult<{ handle: string }>> {
    const script = launchScriptPath(ctx, rec.key);
    try {
      await ctx.files.write(script, launchScript(argv));
    } catch (e) {
      await herdr(["pane", "close", rec.pane]);
      await forget(path);
      return fail("unavailable", `herdr runner: cannot write ${script}: ${message(e)}`);
    }
    const ran = await runIn(rec.pane, ["sh", script]);
    if (!ran.ok) {
      await herdr(["pane", "close", rec.pane]);
      await forget(path);
      return ran;
    }
    const marked = await writeRecord(path, { ...rec, ran: true });
    return marked.ok ? ok({ handle: rec.pane }) : marked;
  }

  async function forget(path: string): Promise<void> {
    await ctx.files.remove(path).catch(() => undefined);
  }

  /** A record that names no pane yet: find the pane the crashed start may have opened, else open one. */
  async function openOrAdopt(path: string, rec: HerdrKeyRecord, req: RunnerStartRequest, adopt: boolean): Promise<PluginResult<{ handle: string }>> {
    const ws = await findWorkspace(req.workspace ?? req.title);
    if (!ws.ok) return ws;
    let workspace = ws.value;
    if (workspace && adopt) {
      const idle = await findIdlePane(workspace, req.title);
      if (!idle.ok) return idle;
      if (idle.value) {
        const named = { ...rec, workspace, pane: idle.value };
        const wrote = await writeRecord(path, named);
        return wrote.ok ? finish(path, named, withEnv(req)) : wrote;
      }
    }
    const opened = await openPane(req, workspace);
    if (!opened.ok) {
      await forget(path);
      return opened;
    }
    workspace = opened.value.workspace;
    const named = { ...rec, workspace, pane: opened.value.pane };
    const wrote = await writeRecord(path, named);
    if (!wrote.ok) return closeAfter(named.pane, wrote);
    return finish(path, named, withEnv(req));
  }

  return {
    name: RUNNER_NAME,
    capabilities: HERDR_CAPABILITIES,

    async start(req) {
      if (!SAFE_KEY.test(req.key)) return fail("invalid", `herdr runner: key ${JSON.stringify(req.key)} is not a safe file name`, false);
      if (req.argv.length === 0) return fail("invalid", "herdr runner: nothing to start (empty argv)", false);
      const path = keyRecordPath(ctx, req.key);
      const known = await readRecord(path);
      if (!known.ok) return known;
      const rec = known.value;
      if (rec?.ran && rec.pane) return ok({ handle: rec.pane });
      if (rec?.pane) {
        const info = await processInfo(rec.pane);
        if (!info.ok) return info;
        // gone, or something already runs there: the command went in before the crash, so it is not sent twice
        if (info.value === null || busy(info.value)) {
          const marked = await writeRecord(path, { ...rec, ran: true });
          return marked.ok ? ok({ handle: rec.pane }) : marked;
        }
        return finish(path, { ...rec, pane: rec.pane }, withEnv(req));
      }
      // a record without a pane is this key's own crashed start, the one case that may adopt a pane
      if (rec) return openOrAdopt(path, rec, req, true);

      const intent: HerdrKeyRecord = { key: req.key, title: req.title, ran: false };
      let made: boolean;
      try {
        made = await ctx.files.create(path, `${JSON.stringify(intent)}\n`);
      } catch (e) {
        return fail("unavailable", `herdr runner: cannot record ${path}: ${message(e)}`);
      }
      if (!made) {
        // another start under the same key recorded first: the run is its to open
        const theirs = await readRecord(path);
        if (!theirs.ok) return theirs;
        if (theirs.value?.pane) return ok({ handle: theirs.value.pane });
        return fail("conflict", `herdr runner: another start of ${req.key} is opening its pane`, true);
      }
      return openOrAdopt(path, intent, req, false);
    },

    async alive(handle) {
      const info = await processInfo(handle);
      return info.ok ? ok(info.value !== null && busy(info.value)) : info;
    },

    async send(handle, text) {
      // herdr's parser (not clap's) reads `<target> <text>` by position, so a text that starts with `-`
      // is still the text; a `--` there would itself be the text and the real text an option
      // (`--wait` would become the flag), as test/integration/send-argv.test.ts shows on herdr itself
      const prompted = await herdr(["agent", "prompt", handle, text]);
      if (prompted.ok) return ok(undefined);
      // no agent herdr recognizes in the pane (a harness herdr does not know): raw text and enter
      if (herdrErrorCode(prompted.failure.message) !== "agent_not_found") return prompted;
      const typed = await herdr(["pane", "send-text", handle, text]);
      if (!typed.ok) return typed;
      const entered = await herdr(["pane", "send-keys", handle, "enter"]);
      return entered.ok ? ok(undefined) : entered;
    },

    async dialog(handle, opts) {
      // herdr reads the agent off its screen, so it sees a prompt that holds the agent before any hook
      const info = await herdrJson(herdr, ["pane", "get", handle], PaneInfo);
      if (isGone(info)) return ok(null);
      if (!info.ok) return info;
      const blocked = info.value.result.pane.agent_status === "blocked";
      if (!blocked && opts?.anyStatus !== true) return ok(null);
      const screen = await herdr(["pane", "read", handle, "--source", "visible", "--lines", String(SCREEN_LINES)]);
      if (isGone(screen)) return ok(null);
      if (!screen.ok) return screen;
      const text = dialogText(screen.value);
      return ok(text || (blocked ? "a prompt herdr reports blocking the agent" : null));
    },

    async keys(handle, keys) {
      // a dialog reads keystrokes, never herdr's `agent prompt`; named keys in a row go as one call
      let named: string[] = [];
      const flush = async (): Promise<PluginResult<void>> => {
        if (named.length === 0) return ok(undefined);
        const sent = await herdr(["pane", "send-keys", handle, ...named]);
        named = [];
        return sent.ok ? ok(undefined) : sent;
      };
      for (const k of keys) {
        if ("key" in k) {
          named.push(k.key);
          continue;
        }
        const flushed = await flush();
        if (!flushed.ok) return flushed;
        const typed = await herdr(["pane", "send-text", handle, k.text]);
        if (!typed.ok) return typed;
      }
      return flush();
    },

    async stop(handle) {
      // without a way to signal the agent, closing its pane is the only way to end it
      if (!ctx.kill) return closePane(handle);
      const info = await processInfo(handle);
      if (!info.ok) return info;
      if (!busy(info.value)) return ok(undefined);
      const agent = info.value?.foreground_process_group_id as number;
      await ctx.kill(agent, "TERM");
      for (let waited = 0; waited < STOP_WAIT_MS; waited += START_POLL_MS) {
        const now = await processInfo(handle);
        if (!now.ok) return now;
        if (!busy(now.value) || now.value?.foreground_process_group_id !== agent) return ok(undefined);
        await sleep(START_POLL_MS);
      }
      await ctx.kill(agent, "KILL");
      return ok(undefined);
    },
  };
}
