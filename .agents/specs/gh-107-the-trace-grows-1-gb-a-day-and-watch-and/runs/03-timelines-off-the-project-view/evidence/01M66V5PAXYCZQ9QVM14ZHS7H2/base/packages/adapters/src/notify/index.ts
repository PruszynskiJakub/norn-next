/**
 * Notifiers (NotifierPort, O3): `os` (default; macOS osascript, Linux notify-send), `ntfy`
 * (JSON publish to a server/topic), `webhook` (POST JSON) and `herdr` (a toast in Herdr, HC14). A notifier only sends: fire-once
 * per inbox item is the caller's duty (receipt-first). `notify` resolves when delivered and
 * throws PortError `notify_failed` (retryable for network/5xx/429) or `config_invalid`.
 */
import type { AdapterContext, InboxGroup, InboxItem, NotifierPort } from "@norn/core";
import type { NotifierConfig } from "@norn/schema";
import { type Exec, bunExec, portError } from "../exec.ts";

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

const GROUP_LABEL: Record<InboxGroup, string> = {
  your_turn: "Your turn",
  answer: "Answer",
  approve: "Approve",
  unblock: "Unblock",
  check: "Check",
  unclaimed: "Unclaimed",
  running: "Running",
  notes: "Notes",
  recently_done: "Recently done",
};

/** Human text shared by every notifier. */
export function render(item: InboxItem): { title: string; subtitle: string; body: string } {
  const unit = item.slice ? `${item.story}/${item.slice}` : item.story;
  return {
    title: `norn · ${GROUP_LABEL[item.group]}`,
    subtitle: item.step ? `${unit} · ${item.step}` : unit,
    body: `${item.title}\n${item.command}`,
  };
}

// ------------------------------------------------------------------ os

export interface OsNotifierOptions {
  platform?: NodeJS.Platform;
  exec?: Exec;
}

/** argv for the platform's notification command; null when unsupported. */
export function osNotifyArgv(platform: NodeJS.Platform, item: InboxItem): string[] | null {
  const { title, subtitle, body } = render(item);
  if (platform === "darwin") {
    // Text travels as argv, so nothing needs AppleScript escaping.
    return [
      "osascript",
      "-e", "on run argv",
      "-e", "display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)",
      "-e", "end run",
      title, subtitle, body,
    ];
  }
  if (platform === "linux") return ["notify-send", "--app-name=norn", `${title} — ${subtitle}`, body];
  return null;
}

export function createOsNotifier(opts: OsNotifierOptions = {}): NotifierPort {
  const exec = opts.exec ?? bunExec;
  const platform = opts.platform ?? process.platform;
  return {
    name: "os",
    async notify(item) {
      const argv = osNotifyArgv(platform, item);
      if (!argv) throw portError("unsupported", `no OS notifier for platform ${platform}`);
      const r = await exec(argv, { timeoutMs: 10_000 });
      if (r.code !== 0) throw portError("notify_failed", `${argv[0]} exited ${r.code}: ${r.stderr.trim()}`, false);
    },
  };
}

// ------------------------------------------------------------------ http (ntfy, webhook)

async function post(fetchFn: Fetch, url: string, headers: Record<string, string>, body: unknown, who: string): Promise<void> {
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  } catch (err) {
    throw portError("notify_failed", `${who}: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw portError("notify_failed", `${who}: HTTP ${res.status} ${text}`.trim(), res.status >= 500 || res.status === 429);
  }
}

const defaultFetch: Fetch = (url, init) => fetch(url, init);

export interface NtfyNotifierOptions {
  /** ntfy server (default https://ntfy.sh) */
  server?: string;
  topic: string;
  /** access token → `Authorization: Bearer` */
  token?: string;
  /** 1–5 */
  priority?: number;
  fetch?: Fetch;
}

/** ntfy JSON publish: POST to the server root with `{topic, title, message, …}`. */
function ntfyRequest(o: NtfyNotifierOptions, item: InboxItem): { url: string; headers: Record<string, string>; body: unknown } {
  const { title, subtitle, body } = render(item);
  const payload: Record<string, unknown> = { topic: o.topic, title: `${title} — ${subtitle}`, message: body, tags: ["norn", item.group] };
  if (item.url) payload.click = item.url;
  if (o.priority !== undefined) payload.priority = o.priority;
  return {
    url: (o.server ?? "https://ntfy.sh").replace(/\/+$/, ""),
    headers: o.token ? { authorization: `Bearer ${o.token}` } : {},
    body: payload,
  };
}

export function createNtfyNotifier(o: NtfyNotifierOptions): NotifierPort {
  const fetchFn = o.fetch ?? defaultFetch;
  return {
    name: "ntfy",
    async notify(item) {
      const req = ntfyRequest(o, item);
      await post(fetchFn, req.url, req.headers, req.body, "ntfy");
    },
  };
}

export interface WebhookNotifierOptions {
  url: string;
  headers?: Record<string, string>;
  fetch?: Fetch;
}

/** Webhook body: the inbox item plus rendered text. */
function webhookBody(item: InboxItem): unknown {
  return { type: "norn.inbox_item", item, text: render(item) };
}

export function createWebhookNotifier(o: WebhookNotifierOptions): NotifierPort {
  const fetchFn = o.fetch ?? defaultFetch;
  return {
    name: "webhook",
    async notify(item) {
      await post(fetchFn, o.url, o.headers ?? {}, webhookBody(item), "webhook");
    },
  };
}

// ------------------------------------------------------------------ factories

function str(options: Record<string, unknown>, key: string, adapter: string, required: true): string;
function str(options: Record<string, unknown>, key: string, adapter: string, required?: false): string | undefined;
function str(options: Record<string, unknown>, key: string, adapter: string, required = false): string | undefined {
  const v = options[key];
  if (typeof v === "string" && v !== "") return v;
  if (v === undefined && !required) return undefined;
  throw portError("config_invalid", `notifier ${adapter}: option ${key} must be a non-empty string`);
}

/** `ntfy` options: `topic` + optional `server`, or `url` (`https://ntfy.sh/<topic>`); `token` or `token_env`; `priority`. */
const ntfyFactory = (ctx: AdapterContext, config: NotifierConfig): NotifierPort => {
  const o = config.options ?? {};
  let server = str(o, "server", "ntfy");
  let topic = str(o, "topic", "ntfy");
  const url = str(o, "url", "ntfy");
  if (url && !topic) {
    const u = new URL(url);
    topic = u.pathname.replace(/^\/+|\/+$/g, "");
    server = u.origin;
  }
  if (!topic) throw portError("config_invalid", "notifier ntfy: set option topic (or url)");
  const tokenEnv = str(o, "token_env", "ntfy");
  const token = str(o, "token", "ntfy") ?? (tokenEnv ? ctx.env[tokenEnv] : undefined);
  const opts: NtfyNotifierOptions = { topic };
  if (server) opts.server = server;
  if (token) opts.token = token;
  if (typeof o.priority === "number") opts.priority = o.priority;
  return createNtfyNotifier(opts);
};

/** `webhook` options: `url`, optional `headers` (string map). */
const webhookFactory = (_ctx: AdapterContext, config: NotifierConfig): NotifierPort => {
  const o = config.options ?? {};
  const url = str(o, "url", "webhook", true);
  const headers: Record<string, string> = {};
  if (o.headers !== undefined) {
    if (typeof o.headers !== "object" || o.headers === null) throw portError("config_invalid", "notifier webhook: headers must be a map");
    for (const [k, v] of Object.entries(o.headers)) if (typeof v === "string") headers[k] = v;
  }
  return createWebhookNotifier({ url, headers });
};

const osFactory = (_ctx: AdapterContext, _config: NotifierConfig): NotifierPort => createOsNotifier();

// ------------------------------------------------------------------ herdr (HC14)

/** Groups whose toast plays Herdr's `request` sound; the rest are silent. */
const HERDR_REQUEST: ReadonlySet<InboxGroup> = new Set(["your_turn", "answer", "approve"]);

export interface HerdrNotifierOptions {
  bin?: string;
  session?: string;
  exec?: Exec;
  env?: Record<string, string | undefined>;
}

/** argv for one Herdr toast. */
export function herdrNotifyArgv(item: InboxItem, o: Pick<HerdrNotifierOptions, "bin" | "session"> = {}): string[] {
  const { title, subtitle, body } = render(item);
  return [
    o.bin ?? "herdr",
    ...(o.session ? ["--session", o.session] : []),
    "notification", "show", `${title} · ${subtitle}`,
    "--body", body,
    "--sound", HERDR_REQUEST.has(item.group) ? "request" : "none",
  ];
}

/** HC14: an inbox item as a Herdr toast; outside Herdr it is `unsupported` and the other notifiers still run. */
export function createHerdrNotifier(o: HerdrNotifierOptions = {}): NotifierPort {
  const exec = o.exec ?? bunExec;
  const env = o.env ?? process.env;
  return {
    name: "herdr",
    async notify(item) {
      if (env.HERDR_ENV !== "1" && !o.session) throw portError("unsupported", "herdr notifier: not running inside Herdr (HERDR_ENV) and no session option");
      const argv = herdrNotifyArgv(item, o);
      const r = await exec(argv, { timeoutMs: 10_000 });
      if (r.code === 127) throw portError("unsupported", `herdr not runnable: ${r.stderr.trim()}`);
      if (r.code !== 0) throw portError("notify_failed", `herdr notification show exited ${r.code}: ${r.stderr.trim()}`, false);
    },
  };
}

export const herdrFactory = (ctx: AdapterContext, config: NotifierConfig): NotifierPort => {
  const options = config.options ?? {};
  const bin = str(options, "bin", "herdr");
  const session = str(options, "session", "herdr");
  return createHerdrNotifier({ env: ctx.env, ...(bin ? { bin } : {}), ...(session ? { session } : {}) });
};

/** Built-in notifier factories keyed by adapter id (NotifierConfig.adapter). */
export const notifiers = { os: osFactory, ntfy: ntfyFactory, webhook: webhookFactory, herdr: herdrFactory };
