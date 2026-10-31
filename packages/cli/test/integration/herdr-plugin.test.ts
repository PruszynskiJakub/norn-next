/** The herdr plugin (HC9): its manifest, and its scripts run through `sh` against stub norn and herdr binaries. */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT as ROOT } from "../../../../test/support/repo-root.ts";

describe("herdr plugin (HC9)", () => {
  test("the manifest parses, has the pick pane and the open/next/pick actions, and names only scripts that exist", () => {
    const dir = join(ROOT, "plugins", "herdr");
    const m = Bun.TOML.parse(readFileSync(join(dir, "herdr-plugin.toml"), "utf8")) as {
      id: string;
      panes: Array<{ id: string; command: string[] }>;
      actions: Array<{ id: string; command: string[] }>;
    };
    expect(m.id).toBe("norn");
    expect(m.panes.map((p) => p.id)).toEqual(["pick"]);
    expect(m.actions.map((a) => a.id)).toEqual(["open", "next", "pick"]);
    const scripts = [...m.panes, ...m.actions].map((e) => e.command.at(-1) as string);
    expect(scripts.filter((s) => !existsSync(join(dir, s)))).toEqual([]);
  });

  test("B8: the actions and panes run the new commands", () => {
    const run = (script: string) => readFileSync(join(ROOT, "plugins", "herdr", script), "utf8");
    expect(run("next.sh")).toContain(`"$NORN" run attach --next --json`);
    expect(run("open.sh")).toContain(`"$NORN" status --watch --pane`);
    expect(run("pick.sh")).toContain(`"$NORN" status --watch >`);
  });

  /** Runs next.sh with a stub norn that refuses with `refusal` and a stub herdr that records the toast. */
  function nextToast(refusal: object): string {
    const dir = mkdtempSync(join(tmpdir(), "norn-next-"));
    const stub = (name: string, body: string) => {
      writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
      return join(dir, name);
    };
    writeFileSync(join(dir, "refusal.json"), JSON.stringify(refusal));
    const env = {
      ...process.env,
      NORN_BIN: stub("norn", `cat "${dir}/refusal.json"; exit 3`),
      HERDR_BIN_PATH: stub("herdr", `printf '%s|' "$@" > "${dir}/toast"`),
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: dir }),
    };
    Bun.spawnSync(["sh", join(ROOT, "plugins", "herdr", "next.sh")], { env });
    return readFileSync(join(dir, "toast"), "utf8");
  }

  test("P8: next.sh branches on the refusal's code, not its text, and keeps escaped quotes", () => {
    const attach = nextToast({ error: 'no live agent pane for "gh-1/01"', do_instead: "norn story start gh-1/01", code: "nothing_to_attach" });
    expect(attach).toContain('no live agent pane for \\"gh-1/01\\"; run: norn story start gh-1/01|');
    const other = nextToast({ error: "No agent waits for you", do_instead: "norn status", code: "not_in_herdr" });
    expect(other).toContain("norn run attach --next failed in ");
    expect(other).toContain(": No agent waits for you|");
  });
});
