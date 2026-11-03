/**
 * gh-61 B11 (D8): `norn watch` checks the repo's norn version again before every tick. A tick it may
 * not run is skipped with one JSON line carrying the B6 refusal; the person is notified once per
 * mismatch; `watch` keeps running and resumes by itself when the version matches again. Driven
 * through `runCli` with the harness, as a binary of any version (S1).
 */
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoConfigPath, workflowsDir } from "@norn/store";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

const WORKFLOW = `name: ship
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

/** set `norn_version` in the main checkout's team file, as a pull or a hand edit would */
function setVersion(h: Harness, v: string): void {
  const file = repoConfigPath(h.root);
  writeFileSync(file, `${readFileSync(file, "utf8").replace(/^norn_version:.*\n?/m, "")}norn_version: ${v}\n`);
}

/** `norn watch` as 0.18.1; `between[i]` runs after tick i+1's line is logged, before the next tick */
async function watchAs181(h: Harness, between: Array<() => void>) {
  const lines: Array<Record<string, unknown>> = [];
  const r = await runChecked(["watch", "--interval", "1ms", "--max-ticks", String(between.length + 1), "--keep-claims"], {
    ...h.deps,
    version: "0.18.1",
    log: (l) => {
      lines.push(JSON.parse(l));
      between[lines.length - 1]?.();
    },
  });
  return { r, lines };
}

const paused = (h: Harness) => h.notifier.items.filter((i) => i.title.endsWith("ticks paused")).map((i) => i.title);
const refusal = (repo: string, line: string) => ({
  at: expect.any(String),
  error: `this repo needs norn ${line} (you run 0.18.1)`,
  do_instead: `install norn ${line}`,
  code: "version_mismatch",
  details: { repo, running: "0.18.1" },
});

describe("watch pauses ticks on a version mismatch (B11, D8)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.config("provider: gh\nworkflow: ship\nmode: manual\n");
    h.write(join(workflowsDir(h.root), "ship.yaml"), WORKFLOW);
    setVersion(h, "0.18.0");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
  });
  afterEach(() => h.cleanup());

  test("AC1: after a pull to 0.19.0, ticks 2–4 are skipped with the refusal, one notification, a normal exit", async () => {
    const { r, lines } = await watchAs181(h, [
      () => {
        setVersion(h, "0.19.0");
        h.remote.issues = [issue(3, "Add totals")]; // a tick that ran would take it in
      },
      () => {},
      () => {},
    ]);
    expect(lines[0]).toHaveProperty("tick_id");
    expect(lines.slice(1)).toEqual([refusal("0.19.0", "0.19.x"), refusal("0.19.0", "0.19.x"), refusal("0.19.0", "0.19.x")]);
    expect(await h.listed("gh-3")).toBeUndefined();
    expect(h.runner.launches).toEqual([]);
    expect(paused(h)).toEqual(["this repo needs norn 0.19.x; ticks paused"]);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ ticks: 4, failed_actions: 0, skipped_version: 3 });
  });

  test("AC2: a matching version resumes ticks; a later mismatch with another version notifies again", async () => {
    const { r, lines } = await watchAs181(h, [
      () => setVersion(h, "0.19.0"),
      () => setVersion(h, "0.18.1"),
      () => setVersion(h, "0.20.0"),
      () => {},
    ]);
    expect(lines[0]).toHaveProperty("tick_id");
    expect(lines[1]).toEqual(refusal("0.19.0", "0.19.x"));
    expect(lines[2]).toHaveProperty("tick_id");
    expect(lines[3]).toEqual(refusal("0.20.0", "0.20.x"));
    expect(lines[4]).toEqual(refusal("0.20.0", "0.20.x"));
    expect(paused(h)).toEqual(["this repo needs norn 0.19.x; ticks paused", "this repo needs norn 0.20.x; ticks paused"]);
    expect(r.exit).toBe(0);
  });

  test("AC2: a mismatch cleared by a match notifies again when the same version comes back", async () => {
    await watchAs181(h, [() => setVersion(h, "0.19.0"), () => setVersion(h, "0.18.0"), () => setVersion(h, "0.19.0")]);
    expect(paused(h)).toEqual(["this repo needs norn 0.19.x; ticks paused", "this repo needs norn 0.19.x; ticks paused"]);
  });
});
