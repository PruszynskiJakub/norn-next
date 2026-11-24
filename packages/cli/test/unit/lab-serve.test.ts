/**
 * `norn lab`'s dashboard flags in process: the port it is served on, and the refusals that come before
 * anything of the lab is built.
 */
import { describe, expect, test } from "bun:test";
import type { ServeOptions } from "@norn/host-node";
import { runCli } from "../../src/index.ts";
import { machine } from "./support.ts";

describe("norn lab --port", () => {
  test("AC2: a port another server holds is refused with port_taken, naming the port, before the lab is built", async () => {
    const asked: number[] = [];
    const m = machine({ env: { TMPDIR: "/tmp/t" } });
    m.io.serve = (o: ServeOptions) => {
      asked.push(o.port);
      return { ok: false, failure: { code: "port_taken", message: `port ${o.port} on 127.0.0.1 is taken by another server` } };
    };
    const r = await runCli(["lab", "--port", "8737"], m.io);
    expect(r.exit).toBe(3);
    expect(r.stdout).toContain("8737");
    const j = await runCli(["lab", "--port", "8737", "--json"], m.io);
    expect(j.exit).toBe(2);
    expect(asked).toEqual([8737]);
    expect(m.exec.calls.filter((c) => c.argv[0] !== "git" || c.argv[1] !== "rev-parse")).toEqual([]);
  });

  test("AC2: the refusal is a CliError with code port_taken and the port in its details", async () => {
    const m = machine({ env: { TMPDIR: "/tmp/t" } });
    m.io.serve = (o: ServeOptions) => ({ ok: false, failure: { code: "port_taken", message: `port ${o.port} on 127.0.0.1 is taken by another server` } });
    // --json is refused with --port, so the refusal's JSON is read from the markdown run's value
    const r = await runCli(["lab", "--port", "8737"], m.io);
    expect(r.value).toMatchObject({ code: "port_taken", details: { port: 8737 }, error: expect.stringContaining("8737") });
  });

  test("a port that is not one, --port with --json, and --port with --tty, are usage errors", async () => {
    const m = machine({ env: { TMPDIR: "/tmp/t" } });
    m.io.serve = () => {
      throw new Error("nothing is served for a usage error");
    };
    for (const p of ["0", "70000", "http"]) expect((await runCli(["lab", "--port", p], m.io)).exit).toBe(2);
    expect((await runCli(["lab", "--port", "8737", "--json"], m.io)).exit).toBe(2);
    expect((await runCli(["lab", "--port", "8737", "--tty"], m.io)).exit).toBe(2);
  });
});

describe("norn lab while its first build runs", () => {
  test("Reset pressed before the lab is built is refused with lab_not_ready, and starts no second build over the first", async () => {
    let handler: ServeOptions["fetch"] | null = null;
    let release: () => void = () => {};
    const building = new Promise<void>((r) => {
      release = r;
    });
    let entered: () => void = () => {};
    const inBuild = new Promise<void>((r) => {
      entered = r;
    });
    const m = machine({
      env: { TMPDIR: "/tmp/t" },
      script: async (argv) => {
        if (argv[0] !== "rm") return undefined;
        entered();
        await building;
        // the build fails after the press, so the command ends without a tick
        return { code: 1, stderr: "the first build stops here" };
      },
    });
    m.io.serve = (o: ServeOptions) => {
      handler = o.fetch;
      return { ok: true, value: { port: 8737, url: "http://127.0.0.1:8737/", stop: async () => {} } };
    };
    const ran = runCli(["lab"], m.io);
    await inBuild;
    const press = handler as ServeOptions["fetch"] | null;
    if (press === null) throw new Error("the dashboard was not served");
    const res = await press(new Request("http://127.0.0.1:8737/api/act/reset", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:8737" }, body: "{}" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "lab_not_ready" });
    release();
    await ran;
    expect(m.exec.calls.filter((c) => c.argv[0] === "rm")).toHaveLength(1);
  });
});
