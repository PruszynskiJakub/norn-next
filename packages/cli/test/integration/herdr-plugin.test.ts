/** norn's herdr plugin: its manifest, and its scripts run through `sh` against stub norn and herdr binaries. */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../../test/support/repo-root.ts";

const PLUGIN = join(REPO_ROOT, "plugins", "herdr");

interface Run {
  dir: string;
  /** each norn call as `<cwd>|<argv>` */
  norn: () => string[];
  /** each herdr call's argv joined by `|` */
  herdr: () => string[];
  stdout: string;
}

/**
 * Runs `script` with a stub norn that records where and how it ran, answers with `answer` and exits
 * `exit`, and a stub herdr that records its argv; the plugin context points at a folder of its own.
 */
function run(script: string, opts: { answer?: object; exit?: number; env?: Record<string, string> } = {}): Run {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-herdr-plugin-")));
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
    return join(dir, name);
  };
  writeFileSync(join(dir, "answer.json"), JSON.stringify(opts.answer ?? {}));
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: dir,
    NORN_BIN: stub("norn", `printf '%s|%s\\n' "$PWD" "$*" >> "${dir}/norn.log"; cat "${dir}/answer.json"; exit ${opts.exit ?? 0}`),
    HERDR_BIN_PATH: stub("herdr", `(IFS='|'; printf '%s\\n' "$*") >> "${dir}/herdr.log"`),
    HERDR_PLUGIN_ID: "norn",
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: dir, workspace_cwd: "/elsewhere" }),
    ...opts.env,
  };
  const r = Bun.spawnSync(["sh", join(PLUGIN, script)], { env, stdin: "ignore" });
  const lines = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean) : []);
  return { dir, norn: () => lines("norn.log"), herdr: () => lines("herdr.log"), stdout: r.stdout.toString() };
}

describe("norn's herdr plugin", () => {
  test("the manifest keeps the ids the person's key bindings name: the pick pane and the open, next and pick actions, each naming a script that exists", () => {
    const m = Bun.TOML.parse(readFileSync(join(PLUGIN, "herdr-plugin.toml"), "utf8")) as {
      id: string;
      panes: Array<{ id: string; command: string[] }>;
      actions: Array<{ id: string; command: string[] }>;
    };
    expect(m.id).toBe("norn");
    expect(m.panes.map((p) => p.id)).toEqual(["pick"]);
    expect(m.actions.map((a) => a.id)).toEqual(["open", "next", "pick"]);
    const scripts = [...m.panes, ...m.actions].map((e) => e.command.at(-1) as string);
    expect(scripts.filter((s) => !existsSync(join(PLUGIN, s)))).toEqual([]);
  });

  test("open runs the cockpit as a split below, in the focused pane's folder", () => {
    const r = run("open.sh");
    expect(r.norn()).toEqual([`${r.dir}|status --watch --pane --json`]);
    expect(r.herdr()).toEqual([]);
  });

  test("open that fails says so in a toast", () => {
    const r = run("open.sh", { exit: 3 });
    expect(r.herdr()).toEqual([`notification|show|norn|--body|norn status --watch --pane failed in ${r.dir}|--sound|none`]);
  });

  test("next focuses the agent waiting longest, and shows nothing when it could", () => {
    const r = run("next.sh", { answer: { unit: "gh-1", run: "r1", focused: true } });
    expect(r.norn()).toEqual([`${r.dir}|run attach --next --json`]);
    expect(r.herdr()).toEqual([]);
  });

  test("next branches on the refusal's code, never its text, and shows a quote in the refusal as a quote", () => {
    const attach = run("next.sh", { exit: 3, answer: { error: 'no live run for "gh-1/01"', do_instead: "norn run start gh-1/01", code: "nothing_to_attach" } });
    expect(attach.herdr()).toEqual(['notification|show|norn|--body|no live run for "gh-1/01"; run: norn run start gh-1/01|--sound|none']);
    const other = run("next.sh", { exit: 6, answer: { error: "no norn config in this checkout", do_instead: "norn init", code: "config_missing" } });
    expect(other.herdr()).toEqual([`notification|show|norn|--body|norn run attach --next failed in ${other.dir}: no norn config in this checkout|--sound|none`]);
  });

  test("pick opens the popup pane, carrying the focused pane's folder and the norn to run", () => {
    const r = run("pick-open.sh");
    expect(r.herdr()).toEqual([`plugin|pane|open|--plugin|norn|--entrypoint|pick|--placement|overlay|--env|NORN_COCKPIT_DIR=${r.dir}|--focus|--env|NORN_BIN=${r.dir}/norn`]);
  });

  test("the pick pane runs the cockpit in the folder it was given, and shows a refusal before it closes", () => {
    const ok = run("pick.sh", { env: { NORN_COCKPIT_DIR: "/" } });
    expect(ok.norn()).toEqual(["/|status --watch"]);
    expect(ok.stdout).toBe("");
    const refused = run("pick.sh", { exit: 6, answer: { error: "no norn config" }, env: { NORN_COCKPIT_DIR: "/" } });
    expect(refused.stdout).toBe('{"error":"no norn config"}\n\nnorn status --watch exited 6 in /. Press Enter to close.');
  });
});
