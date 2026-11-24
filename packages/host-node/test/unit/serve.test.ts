/**
 * The host's HTTP server: bound to the loopback address, on a free port when asked for none, and a
 * port another server holds is refused by name rather than thrown.
 */
import { describe, expect, test } from "bun:test";
import { serveHttp } from "../../src/index.ts";

const hello = async (req: Request) => new Response(`hello ${new URL(req.url).pathname}`);

describe("serveHttp", () => {
  test("port 0 serves on a free port of 127.0.0.1 and names its URL; stop closes it", async () => {
    const r = serveHttp({ port: 0, fetch: hello });
    if (!r.ok) throw new Error(r.failure.message);
    try {
      expect(r.value.port).toBeGreaterThan(0);
      expect(r.value.url).toBe(`http://127.0.0.1:${r.value.port}/`);
      expect(await (await fetch(`${r.value.url}x`)).text()).toBe("hello /x");
    } finally {
      await r.value.stop();
    }
    await expect(fetch(r.value.url)).rejects.toThrow();
  });

  test("a port another server holds is refused with port_taken, naming the port", async () => {
    const first = serveHttp({ port: 0, fetch: hello });
    if (!first.ok) throw new Error(first.failure.message);
    try {
      const second = serveHttp({ port: first.value.port, fetch: hello });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.failure.code).toBe("port_taken");
      expect(second.failure.message).toContain(String(first.value.port));
    } finally {
      await first.value.stop();
    }
  });
});
