/**
 * A local HTTP server for a page a person opens on this machine, such as the lab's dashboard. It is
 * bound to the loopback address only, so nothing beyond this machine reaches it.
 */

export const LOOPBACK = "127.0.0.1";

export interface HttpServer {
  port: number;
  /** `http://127.0.0.1:<port>/` */
  url: string;
  stop(): Promise<void>;
}

export type ServeResult = { ok: true; value: HttpServer } | { ok: false; failure: { code: "port_taken" | "serve_failed"; message: string } };

export interface ServeOptions {
  /** 0 picks a free port */
  port: number;
  fetch(req: Request): Promise<Response>;
}

export type ServeHttp = (opts: ServeOptions) => ServeResult;

export const serveHttp: ServeHttp = (opts) => {
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ hostname: LOOPBACK, port: opts.port, fetch: opts.fetch });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const taken = (e as { code?: unknown }).code === "EADDRINUSE" || /in use|EADDRINUSE/i.test(message);
    if (taken) return { ok: false, failure: { code: "port_taken", message: `port ${opts.port} on ${LOOPBACK} is taken by another server` } };
    return { ok: false, failure: { code: "serve_failed", message: `could not serve on ${LOOPBACK}:${opts.port}: ${message}` } };
  }
  const port = server.port as number;
  return { ok: true, value: { port, url: `http://${LOOPBACK}:${port}/`, stop: () => server.stop(true) } };
};
