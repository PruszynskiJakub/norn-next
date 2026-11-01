/**
 * gh-110 B11–B17 (D6): `norn migrate` moves a main checkout from the old layout to the new one. The
 * config and workflows move as staged git renames, the machine-local files into the machine dir,
 * norn's old `.gitignore` line goes; nothing is committed. It refuses outside the main checkout, with
 * a part in both places, or while the tick lock is held; it does nothing on a migrated repo, and a
 * rerun finishes an interrupted one. The old paths are spelled out in the harness: what a person had.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { type ClaimBlob, validate } from "@norn/schema";
import { acquireLock, readLocalClaim, repoConfigPath, workflowsDir } from "@norn/store";
import type { CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, layoutPlaces, oldNornDir, runChecked, sh, toOldLayout } from "../../../../test/support/harness.ts";

// whole flows over real git, several ticks each
setDefaultTimeout(60_000);

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: solo
default_mode: manual
notifiers: []
`;

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

/** The `.gitignore` of a repo an older norn set up: the person's lines around norn's. */
const OLD_GITIGNORE = `node_modules/
dist
# norn (machine-local)
.agents/norn/trace/
.env.norn
.norn-unit
*.log
`;

const OLD_CONFIG = ".agents/norn/config.yaml";
const OLD_WORKFLOWS = ".agents/norn/workflows";
const NEW_CONFIG = ".agents/norn.config.yaml";
const NEW_WORKFLOWS = ".agents/workflows";

interface Migrated {
  moves: Array<{ part: string; from: string; to: string; how: string }>;
  staged: string[];
  commit: string | null;
}

/** A repo set up and ticked on the new layout, then moved back to the old one and committed, as an older norn left it. */
async function oldRepo(): Promise<{ h: Harness; workflows: string[] }> {
  const h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.write(join(workflowsDir(h.root), "quick.yaml"), SOLO.replace("name: solo", "name: quick"));
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(4, "Four")];
  for (let i = 0; i < 3; i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  const workflows = readdirSync(workflowsDir(h.root)).sort();
  toOldLayout(h.root);
  h.write(join(h.root, ".gitignore"), OLD_GITIGNORE);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "on the old layout"]);
  h.git(["push", "-q", "origin", "main"]);
  return { h, workflows };
}

const porcelain = (h: Harness) => sh(h.root, ["status", "--porcelain"]).trimEnd();
const head = (h: Harness) => sh(h.root, ["rev-parse", "HEAD"]).trim();

/** Every file under the checkout (outside `.git`) and under the norn home, and the git status: what "moves nothing" compares. */
function snapshot(h: Harness): string[] {
  const list = (dir: string) => (readdirSync(dir, { recursive: true }) as string[]).filter((p) => !p.startsWith(".git/") && p !== ".git").map((p) => join(dir, p));
  return [...list(h.root), ...list(h.home), porcelain(h)].sort();
}

function expectRefused(r: CliResult, code: string) {
  expect(r.exit).toBe(3);
  expect(r.value).toMatchObject({ code });
  expect(validate("cli-error", r.value).ok).toBe(true);
}

describe("norn migrate on the old layout (B11, B12, B13)", () => {
  let h: Harness;
  let workflows: string[];
  let heartbeat: string;
  let claimBefore: ClaimBlob;
  let headBefore: string;
  let out: CliResult;
  beforeAll(async () => {
    ({ h, workflows } = await oldRepo());
    heartbeat = JSON.parse(h.read(join(layoutPlaces(h.root)["machine files"].old, "heartbeat.json"))).heartbeat_id;
    const c = await readLocalClaim(h.root, "gh-4");
    if (c.state !== "present") throw new Error(`no claim on gh-4: ${c.state}`);
    claimBefore = c.blob;
    headBefore = head(h);
    out = await h.norn("migrate");
  });
  afterAll(() => h.cleanup());

  test("the config and workflows are staged git renames, nothing committed; the output lists each move and ends with the commit (B11)", () => {
    expect(out.exit).toBe(0);
    expect(head(h)).toBe(headBefore);
    const lines = porcelain(h).split("\n").sort();
    expect(lines).toEqual(
      [`R  ${OLD_CONFIG} -> ${NEW_CONFIG}`, ...workflows.map((w) => `R  ${OLD_WORKFLOWS}/${w} -> ${NEW_WORKFLOWS}/${w}`), "M  .gitignore"].sort(),
    );
    expect(out.stdout).toContain(`${OLD_CONFIG} → ${NEW_CONFIG}`);
    for (const w of workflows) expect(out.stdout).toContain(`${OLD_WORKFLOWS}/${w} → ${NEW_WORKFLOWS}/${w}`);
    expect(out.stdout.trimEnd().split("\n").at(-1)).toContain("git commit");
  });

  test("the machine-local files are in the machine dir with the same heartbeat; .agents/norn/ is gone (B12)", () => {
    const machine = layoutPlaces(h.root)["machine files"].new;
    expect(JSON.parse(readFileSync(join(machine, "heartbeat.json"), "utf8")).heartbeat_id).toBe(heartbeat);
    expect(existsSync(oldNornDir(h.root))).toBe(false);
    expect(out.stdout).toContain(machine);
  });

  test("norn's old .gitignore line is gone and staged; the person's lines are untouched (B13)", () => {
    expect(h.read(join(h.root, ".gitignore"))).toBe(OLD_GITIGNORE.replace(".agents/norn/trace/\n", ""));
    expect(porcelain(h)).toContain("M  .gitignore");
  });

  test("the next tick recognises its own claim (ID2)", async () => {
    h.git(["commit", "-q", "-m", "norn: move to the new layout"]);
    // past the renewal (3m), inside the lease (10m): only a tick that knows the claim is its own renews it
    h.clock.advance(4 * 60_000);
    await h.tick();
    const c = await readLocalClaim(h.root, "gh-4");
    if (c.state !== "present") throw new Error(`no claim on gh-4: ${c.state}`);
    expect(c.blob.heartbeat_id).toBe(heartbeat);
    expect(c.blob.acquired_at).toBe(claimBefore.acquired_at);
    expect(Date.parse(c.blob.renewed_at)).toBeGreaterThan(Date.parse(claimBefore.renewed_at));
  });

  test("a second run says nothing to move, exits 0 and changes nothing (B14)", async () => {
    const before = snapshot(h);
    const md = await h.norn("migrate");
    expect(md.exit).toBe(0);
    expect(md.stdout).toContain("nothing to move");
    const json = await h.norn("migrate", "--json");
    expect(json.exit).toBe(0);
    expect(json.value).toEqual({ moves: [], staged: [], commit: null });
    expect(snapshot(h)).toEqual(before);
  });
});

describe("norn migrate --json (B11)", () => {
  let h: Harness;
  let workflows: string[];
  beforeAll(async () => ({ h, workflows } = await oldRepo()));
  afterAll(() => h.cleanup());

  test("gives {moves, staged, commit}", async () => {
    const r = await h.norn("migrate", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Migrated;
    expect(Object.keys(v).sort()).toEqual(["commit", "moves", "staged"]);
    const machine = layoutPlaces(h.root)["machine files"];
    expect(v.moves).toEqual([
      { part: "config", from: OLD_CONFIG, to: NEW_CONFIG, how: "git mv" },
      ...workflows.map((w) => ({ part: "workflows", from: `${OLD_WORKFLOWS}/${w}`, to: `${NEW_WORKFLOWS}/${w}`, how: "git mv" })),
      { part: "machine files", from: relative(h.root, machine.old), to: machine.new, how: "moved" },
    ]);
    expect(v.staged.sort()).toEqual([NEW_CONFIG, ...workflows.map((w) => `${NEW_WORKFLOWS}/${w}`), ".gitignore"].sort());
    expect(v.commit).toStartWith("git commit -m ");
  });
});

describe("norn migrate refuses and moves nothing (B15, B16, B17)", () => {
  let h: Harness;
  beforeAll(async () => ({ h } = await oldRepo()));
  afterAll(() => h.cleanup());

  test("with the tick lock held the way watch holds it: exit 3, do_instead to stop watch and run it again (B15)", async () => {
    const lock = await acquireLock(join(layoutPlaces(h.root)["machine files"].old, "tick.lock"), { note: "norn watch" });
    if (!lock.ok) throw new Error("could not take the tick lock");
    try {
      const before = snapshot(h);
      const r = await h.norn("migrate", "--json");
      expectRefused(r, "tick_locked");
      expect((r.value as { do_instead: string }).do_instead).toContain("stop norn watch");
      expect((r.value as { do_instead: string }).do_instead).toContain("norn migrate");
      expect(snapshot(h)).toEqual(before);
    } finally {
      lock.release();
    }
  });

  test("in a unit worktree: exit 3, do_instead names the main checkout's path (B16)", async () => {
    const wt = `${h.root}-worktrees/gh-4-four`;
    expect(existsSync(wt)).toBe(true);
    const before = [...snapshot(h), ...(readdirSync(wt, { recursive: true }) as string[]).filter((p) => !p.startsWith(".git"))];
    const r = await runChecked(["migrate", "--json"], { ...h.deps, cwd: wt });
    expectRefused(r, "not_main_checkout");
    expect((r.value as { do_instead: string }).do_instead).toContain(h.root);
    expect((r.value as { do_instead: string }).do_instead).toContain("norn migrate");
    expect([...snapshot(h), ...(readdirSync(wt, { recursive: true }) as string[]).filter((p) => !p.startsWith(".git"))]).toEqual(before);
  });

  test("with one part in both places: exit 3 naming both paths (B17)", async () => {
    const { old, new: now } = layoutPlaces(h.root).config;
    cpSync(old, now);
    try {
      const before = snapshot(h);
      const r = await h.norn("migrate", "--json");
      expectRefused(r, "both_layouts");
      const error = (r.value as { error: string }).error;
      expect(error).toContain(relative(h.root, old));
      expect(error).toContain(relative(h.root, now));
      expect(snapshot(h)).toEqual(before);
    } finally {
      rmSync(now);
    }
  });
});

describe("a rerun finishes an interrupted migration (B11, B12)", () => {
  let h: Harness;
  beforeAll(async () => ({ h } = await oldRepo()));
  afterAll(() => h.cleanup());

  test("config and workflows moved, the trace not: migrate moves the trace", async () => {
    const places = layoutPlaces(h.root);
    // what a run cut short after the staged renames left
    h.git(["mv", OLD_CONFIG, NEW_CONFIG]);
    h.git(["mv", OLD_WORKFLOWS, NEW_WORKFLOWS]);
    const heartbeat = JSON.parse(h.read(join(places["machine files"].old, "heartbeat.json"))).heartbeat_id;
    const r = await h.norn("migrate", "--json");
    expect(r.exit).toBe(0);
    expect((r.value as Migrated).moves.map((m) => m.part)).toEqual(["machine files"]);
    expect(JSON.parse(h.read(join(places["machine files"].new, "heartbeat.json"))).heartbeat_id).toBe(heartbeat);
    expect(existsSync(oldNornDir(h.root))).toBe(false);
    expect(porcelain(h)).toContain(`R  ${OLD_CONFIG} -> ${NEW_CONFIG}`);
    expect((await h.norn("status", "--json")).exit).toBe(0);
  });
});

describe("a rerun finishes a trace move cut short (B12, D6)", () => {
  let h: Harness;
  beforeAll(async () => ({ h } = await oldRepo()));
  afterAll(() => h.cleanup());

  test("part of the trace in the machine dir, the rest at its old place: migrate moves the rest", async () => {
    const { old, new: machine } = layoutPlaces(h.root)["machine files"];
    const heartbeat = h.read(join(old, "heartbeat.json"));
    cpSync(join(old, "heartbeat.json"), join(machine, "heartbeat.json"));
    rmSync(join(old, "heartbeat.json"));
    const rest = readdirSync(old).sort();
    expect(rest.length).toBeGreaterThan(0);
    const r = await h.norn("migrate", "--json");
    expect(r.exit).toBe(0);
    for (const n of rest) expect(existsSync(join(machine, n))).toBe(true);
    expect(h.read(join(machine, "heartbeat.json"))).toBe(heartbeat);
    expect(existsSync(oldNornDir(h.root))).toBe(false);
  });

  test("a file in both places is refused naming both paths", async () => {
    const h2 = await oldRepo();
    try {
      const { old, new: machine } = layoutPlaces(h2.h.root)["machine files"];
      cpSync(join(old, "heartbeat.json"), join(machine, "heartbeat.json"));
      const before = snapshot(h2.h);
      const r = await h2.h.norn("migrate", "--json");
      expectRefused(r, "both_layouts");
      const error = (r.value as { error: string }).error;
      expect(error).toContain(relative(h2.h.root, join(old, "heartbeat.json")));
      expect(error).toContain(join(machine, "heartbeat.json"));
      expect(snapshot(h2.h)).toEqual(before);
    } finally {
      h2.h.cleanup();
    }
  });
});

describe("an untracked old workflow file (B11)", () => {
  let h: Harness;
  beforeAll(async () => ({ h } = await oldRepo()));
  afterAll(() => h.cleanup());

  test("is moved plainly and listed as untracked", async () => {
    h.write(join(h.root, OLD_WORKFLOWS, "draft.yaml"), SOLO.replace("name: solo", "name: draft"));
    const r = await h.norn("migrate", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Migrated;
    expect(v.moves).toContainEqual({ part: "workflows", from: `${OLD_WORKFLOWS}/draft.yaml`, to: `${NEW_WORKFLOWS}/draft.yaml`, how: "untracked" });
    expect(v.staged).not.toContain(`${NEW_WORKFLOWS}/draft.yaml`);
    expect(existsSync(join(h.root, NEW_WORKFLOWS, "draft.yaml"))).toBe(true);
    expect(porcelain(h)).toContain(`?? ${NEW_WORKFLOWS}/draft.yaml`);
    const md = await h.norn("migrate");
    expect(md.stdout).toContain("nothing to move");
  });
});
