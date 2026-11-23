/**
 * `norn lab [--clean] [--port <n>]`: a throwaway norn repo under the temp directory where the lab's
 * stand-in agent plays a story through its eight beats. It builds the lab, or resumes the one there,
 * then serves the lab's dashboard on localhost and ticks the lab until a signal stops it: the page
 * shows the story live and its buttons run the person's real commands. It prints the page's URL and
 * opens no browser. With `--json` it prints where the lab is and its beat as one JSON value, and
 * serves nothing, as a JSON answer is one value and ends.
 */
import { tmpdir } from "node:os";
import { defineCommand, opt } from "../command.ts";
import type { CliContext } from "../context.ts";
import { runLabCommand } from "../lab/act.ts";
import { buttonCommand, dashboardState, labHandler, type LabActionName } from "../lab/dashboard.ts";
import { CHILD_TIMEOUT_MS, labEnv, labMarkdown, type LabRun, type LabView, openLab } from "../lab/lab.ts";
import { LAB_PAGE } from "../lab/page.ts";
import { labPaths } from "../lab/paths.ts";
import { readLab } from "../lab/read.ts";
import { labMerge, labScript } from "../lab/script.ts";
import { failure, refuse, rendered, usageError } from "../output.ts";

/** How long the lab waits between its ticks while the dashboard is served. */
export const LAB_TICK_MS = 2000;
const MAX_PORT = 65535;

function portOf(text: string | undefined): number {
  if (text === undefined) return 0;
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PORT) throw usageError(`--port takes a port from 1 to ${MAX_PORT}, not ${JSON.stringify(text)}`, "norn lab --port 8737, or leave --port out for a free one", "usage");
  return n;
}

/** Resolves after `ms`, or as soon as the signal aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Runs each call after the one before it ends. The lab's ticks and the person's buttons go through
 * one queue: a reset removes the lab's norn home, and a tick still writing there would put the old
 * story's state back into the lab built after it.
 */
function oneAtATime(): <T>(call: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (call) => {
    const next = last.then(call, call);
    last = next.catch(() => {});
    return next;
  };
}

/** `norn tick` in the lab, again and again, as `norn watch` would, until the signal aborts. */
async function tickLab(ctx: CliContext, lab: LabRun, serial: ReturnType<typeof oneAtATime>): Promise<void> {
  const signal = ctx.io.signal;
  const sleep = ctx.io.sleep ?? pause;
  const log = ctx.io.log ?? (() => {});
  let said = "";
  while (!signal?.aborted) {
    const r = await serial(() => lab.host.exec([...lab.self, "tick", "--json"], { cwd: lab.paths.repo, env: labEnv(lab.paths), timeoutMs: CHILD_TIMEOUT_MS }));
    // a tick fails while a reset rebuilds the lab: said once, and the next tick tries again
    const line = r.code === 0 ? "" : `norn lab: a tick exited ${r.code}: ${(r.stderr.trim() || r.stdout.trim()).split("\n")[0]?.slice(0, 300) ?? ""}`;
    if (line !== said && line !== "") log(line);
    said = line;
    await sleep(LAB_TICK_MS, signal);
  }
}

export const labCommand = defineCommand({
  name: "lab",
  summary: "Build or resume a throwaway lab repo where a stand-in agent plays a story in eight beats, and serve its dashboard",
  usage: "norn lab [--clean] [--port <n>]",
  options: { clean: { type: "boolean" }, port: { type: "string" } },
  optionHelp: {
    "--clean": "remove the lab and build it again, from beat 1",
    "--port <n>": "serve the dashboard on this port of localhost (default: a free one); refused when it is taken",
  },
  async run(ctx, args) {
    const paths = labPaths(ctx.env.TMPDIR?.trim() || tmpdir());
    const host = ctx.io.hosts.host({ root: paths.repo, dataDir: paths.home });
    const lab: LabRun = { host, paths, self: ctx.io.self };
    const clean = opt.bool(args, "clean");
    const portText = opt.str(args, "port");
    if (args.json) {
      if (portText !== undefined) throw usageError("--port serves the dashboard, and --json serves nothing", "norn lab --port <n>, or norn lab --json");
      const view = await openLab(lab, { clean });
      return rendered(view, labMarkdown(view));
    }
    const port = portOf(portText);
    const serve = ctx.io.serve;
    if (serve === undefined) throw refuse("norn lab cannot serve its dashboard from here", "norn lab --json", "serve_unavailable");

    const script = labScript();
    let view: LabView | null = null;
    const serial = oneAtATime();
    const served = serve({
      port,
      fetch: labHandler({
        page: LAB_PAGE,
        state: async () => dashboardState(await readLab(ctx.io, paths), (key) => labMerge(script, key)),
        act: async (name: LabActionName, typed: string | undefined) => {
          const key = view?.story ?? null;
          const command = buttonCommand(name, key === null ? null : { key, workflow: script.workflow, merge: labMerge(script, key) }, typed);
          if (command === null) throw refuse(`${name} needs the lab's story, and the lab has none yet`, "wait for the lab to build, or press Reset", "lab_not_ready");
          return serial(async () => {
            const answer = await runLabCommand(lab, name, command);
            if (name === "reset") view = await openLab(lab, { clean: false });
            return answer;
          });
        },
      }),
    });
    if (!served.ok) {
      if (served.failure.code === "port_taken") throw refuse(served.failure.message, "norn lab --port <another port>, or leave --port out for a free one", "port_taken", { port });
      throw failure(served.failure.message, "norn lab --port <another port>", "serve_failed");
    }
    const log = ctx.io.log ?? (() => {});
    try {
      log(`norn lab: the dashboard is at ${served.value.url}`);
      view = await openLab(lab, { clean });
      log(labMarkdown(view));
      log(`norn lab: ticking the lab every ${LAB_TICK_MS / 1000}s; open ${served.value.url} and press Ctrl-C to stop`);
      await tickLab(ctx, lab, serial);
    } finally {
      await served.value.stop();
    }
    return rendered({ ...view, url: served.value.url }, `${labMarkdown(view)}\n\nThe dashboard at ${served.value.url} stopped.`);
  },
});
