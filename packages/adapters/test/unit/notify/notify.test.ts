import { describe, expect, test } from "bun:test";
import type { AdapterContext, InboxItem } from "@norn/core";
import {
  type Fetch,
  createNtfyNotifier,
  createOsNotifier,
  createWebhookNotifier,
  notifiers,
  osNotifyArgv,
} from "../../../src/notify/index.ts";
import type { Exec } from "../../../src/exec.ts";

const item: InboxItem = {
  id: "01JRECEIPT",
  group: "answer",
  story: "gh-123",
  slice: "03-api",
  step: "implement",
  title: 'Use "v2" endpoint?',
  command: 'norn story answer gh-123/03 "..."',
  since: "2026-10-23T10:00:00.000Z",
  url: "https://github.com/o/r/issues/123",
};

function fakeFetch(status = 200, throws = false) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (throws) throw new Error("ECONNREFUSED");
    return { ok: status < 300, status, text: async () => "nope" };
  };
  return { fetch, calls };
}

describe("os notifier", () => {
  test("macOS passes text as osascript argv (no escaping)", () => {
    const argv = osNotifyArgv("darwin", item)!;
    expect(argv[0]).toBe("osascript");
    expect(argv.slice(-3)).toEqual(["norn · Answer", "gh-123/03-api · implement", 'Use "v2" endpoint?\nnorn story answer gh-123/03 "..."']);
  });

  test("Linux uses notify-send; other platforms are unsupported", async () => {
    expect(osNotifyArgv("linux", item)?.[0]).toBe("notify-send");
    const err = await createOsNotifier({ platform: "win32" }).notify(item).catch((e) => e);
    expect(err).toMatchObject({ code: "unsupported" });
  });

  test("non-zero exit → notify_failed", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (argv) => (calls.push(argv), { code: 1, stdout: "", stderr: "denied" });
    const err = await createOsNotifier({ platform: "linux", exec }).notify(item).catch((e) => e);
    expect(err).toMatchObject({ code: "notify_failed" });
    expect(calls).toHaveLength(1);
  });
});

describe("ntfy notifier", () => {
  test("JSON publish to the server root with topic, click and bearer token", async () => {
    const f = fakeFetch();
    await createNtfyNotifier({ server: "https://ntfy.example/", topic: "norn-me", token: "tk", fetch: f.fetch }).notify(item);
    expect(f.calls[0]).toEqual({
      url: "https://ntfy.example",
      headers: { "content-type": "application/json", authorization: "Bearer tk" },
      body: {
        topic: "norn-me",
        title: "norn · Answer — gh-123/03-api · implement",
        message: 'Use "v2" endpoint?\nnorn story answer gh-123/03 "..."',
        tags: ["norn", "answer"],
        click: "https://github.com/o/r/issues/123",
      },
    });
  });

  test("5xx and network errors are retryable, 4xx not", async () => {
    const n = (s: number, t = false) => createNtfyNotifier({ topic: "t", fetch: fakeFetch(s, t).fetch }).notify(item).catch((e) => e);
    expect(await n(503)).toMatchObject({ code: "notify_failed", retryable: true });
    expect(await n(200, true)).toMatchObject({ code: "notify_failed", retryable: true });
    expect(await n(403)).toMatchObject({ code: "notify_failed", retryable: false });
  });

  test("factory accepts a topic url and token_env", async () => {
    const ctx = { env: { NTFY_TOKEN: "secret" } } as unknown as AdapterContext;
    expect(notifiers.ntfy(ctx, { adapter: "ntfy", options: { url: "https://ntfy.sh/abc", token_env: "NTFY_TOKEN" } }).name).toBe("ntfy");
    expect(() => notifiers.ntfy(ctx, { adapter: "ntfy" })).toThrow();
  });
});

describe("webhook notifier", () => {
  test("POSTs the inbox item as JSON with configured headers", async () => {
    const f = fakeFetch();
    await createWebhookNotifier({ url: "https://hooks.example/x", headers: { "x-token": "a" }, fetch: f.fetch }).notify(item);
    expect(f.calls[0]!.url).toBe("https://hooks.example/x");
    expect(f.calls[0]!.headers).toEqual({ "content-type": "application/json", "x-token": "a" });
    expect(f.calls[0]!.body).toMatchObject({ type: "norn.inbox_item", item });
  });

  test("factory requires url", () => {
    expect(() => notifiers.webhook({} as AdapterContext, { adapter: "webhook" })).toThrow(/url/);
  });
});
