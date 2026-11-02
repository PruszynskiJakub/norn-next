/** gh-64 S3: which runner and notifiers a resolved config builds (B12, B19, B20, D9, D15), through `buildPorts` with a recording registry. */
import { describe, expect, test } from "bun:test";
import type { AdapterContext, AdapterRegistry, NotifierPort, RunnerPort } from "@norn/core";
import { DEFAULT_CONFIG, type NotifierConfig, type ResolvedConfig, type RunnerConfig } from "@norn/schema";
import { CliFailure } from "../../src/output.ts";
import { buildPorts } from "../../src/wiring.ts";

function recording() {
  const built: { runners: RunnerConfig[]; notifiers: NotifierConfig[] } = { runners: [], notifiers: [] };
  const runner = (name: string) => (_: AdapterContext, c: RunnerConfig) => (built.runners.push(c), { name } as unknown as RunnerPort);
  const notifier = (_: AdapterContext, c: NotifierConfig): NotifierPort => {
    if (c.adapter === "ntfy" && c.options?.url === "https://broken") throw new Error("bad ntfy url");
    built.notifiers.push(c);
    const unreachable = c.options?.url === "https://unreachable";
    return {
      name: c.adapter,
      notify: async () => {
        if (unreachable) throw new Error("fetch failed");
      },
    };
  };
  const registry = {
    git: () => ({}),
    process: () => ({}),
    remotes: { gh: () => ({}), glab: () => ({}) },
    runners: { herdr: runner("herdr"), headless: runner("headless") },
    agents: { claude: () => ({}), codex: () => ({}), opencode: () => ({}), gemini: () => ({}) },
    notifiers: { os: notifier, ntfy: notifier, webhook: notifier, herdr: notifier },
  } as unknown as AdapterRegistry;
  return { registry, built };
}

const actx = (config: ResolvedConfig, env: Record<string, string | undefined> = {}): AdapterContext => ({ repoRoot: "/r", home: "/h", config, clock: { now: () => 0, iso: () => "" } as never, env });

describe("buildPorts (S3)", () => {
  test("B12: no runner key — the detected runner is built (headless without Herdr)", async () => {
    const { registry, built } = recording();
    const ports = await buildPorts(registry, actx(DEFAULT_CONFIG), DEFAULT_CONFIG);
    expect(ports.runner?.name).toBe("headless");
    expect(built.runners).toEqual([{ adapter: "headless" }]);
  });

  test("B19 (D9): notify builds OS unless os: false, plus ntfy and webhook from their URL", async () => {
    const { registry, built } = recording();
    const config = { ...DEFAULT_CONFIG, notify: { os: true, ntfy: "https://ntfy.sh/my-norn" } };
    expect((await buildPorts(registry, actx(config), config)).notifiers.map((n) => n.name)).toEqual(["os", "ntfy"]);
    expect(built.notifiers.at(-1)).toEqual({ adapter: "ntfy", options: { url: "https://ntfy.sh/my-norn" } });
    const quiet = { ...DEFAULT_CONFIG, notify: { os: false, webhook: "https://example.com/h" } };
    expect((await buildPorts(registry, actx(quiet), quiet)).notifiers.map((n) => n.name)).toEqual(["webhook"]);
  });

  test("B20: inside Herdr the Herdr notifier is on by itself", async () => {
    const { registry } = recording();
    const ports = await buildPorts(registry, actx(DEFAULT_CONFIG, { HERDR_ENV: "1" }), DEFAULT_CONFIG);
    expect(ports.notifiers.map((n) => n.name)).toEqual(["os", "herdr"]);
  });

  test("B47 (D15): an adapter that fails to build names the file its setting came from", async () => {
    const { registry } = recording();
    const config = { ...DEFAULT_CONFIG, notify: { os: true, ntfy: "https://broken" } };
    const err = await buildPorts(registry, actx(config), config, {}, (k) => (k === "notify.ntfy" ? "/home/me/.norn/config.yaml" : null)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliFailure);
    expect((err as CliFailure).body).toMatchObject({ error: "notify ntfy: bad ntfy url", do_instead: "fix it in /home/me/.norn/config.yaml", code: "config_invalid" });
  });

  test("B47 (D15): an unreachable ntfy URL fails at send time naming the file it came from", async () => {
    const { registry } = recording();
    const config = { ...DEFAULT_CONFIG, notify: { os: false, ntfy: "https://unreachable" } };
    const ports = await buildPorts(registry, actx(config), config, {}, (k) => (k === "notify.ntfy" ? "/home/me/.norn/config.yaml" : null));
    const err = await ports.notifiers[0]?.notify({} as never).catch((e: unknown) => e);
    expect((err as Error).message).toBe("notify ntfy: fetch failed; fix it in /home/me/.norn/config.yaml");
  });
});
