/**
 * The commands a person runs around the stories, through the CLI alone, every norn call a subprocess
 * of the binary from source: a broken or old config, doctor over skills and workflows that cannot
 * run, story create's refusals, removed command names, status and story view on the keys a person
 * types, where worktrees live, and two repos sharing one norn home.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_LOCAL_FILE } from "../../src/index.ts";
import { awaitNote, type NornOut, norn, setUp, sh, status, tickUntil, type UnitShown, type World, world, worktreeOf } from "./world.ts";

const KEY = "lt-1";
const SLOW = 300_000;
const PACK_SKILLS = join(import.meta.dir, "..", "..", "..", "pack-sdlc", "assets", "skills");

const GATED = ["name: gated", "start: look", "steps:", "  look:", "    gate: Look at it.", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n");
const USES = ["name: uses", "start: look", "steps:", "  look:", "    use: ask", "    outcomes: { approved: $done }", ""].join("\n");
const SHARED_ASK = ["start: q", "steps:", "  q:", "    gate: Ask it.", "    outcomes: { approve: { exit: approved }, reject: $stuck }", ""].join("\n");
/** One agent step naming a pack skill and a skill of the repo's own. */
const SKILLED = ["name: skilled", "start: build", "steps:", "  build:", "    agent: Build the thing.", "    skills: [norn-tdd, house-style]", "    outcomes: { done: $done }", ""].join("\n");

const parkedAt = (step: string) => (u: UnitShown | null) => u?.step === step && u.waiting?.for === "gate";

async function person(w: World, ...args: string[]): Promise<NornOut> {
  const r = await norn(w, [...args, "--json"]);
  if (r.code !== 0) throw new Error(`${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r;
}

/** Every file under `dir` (git's own folder aside) with a hash of its text: a before and after of what a command wrote. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (name === ".git" && at === dir) continue;
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

type Check = { name: string; ok: boolean; detail?: string; error?: string; code?: string };
const checkOf = (doctor: NornOut, name: string): Check | undefined => (doctor.body.checks as Check[]).find((c) => c.name === name);

describe("a person's commands on a repo with a story at its gate", () => {
  let w: World;
  const rules: string[] = [];
  let blank: NornOut;
  let untitled: NornOut;
  let statusAfterBadCreates: { stories: unknown[]; intake: unknown[] };
  let gitAfterBadCreates = "";
  let unknownWorkflow: NornOut;
  let unknownWorkflowMd: NornOut;
  let removed: Array<{ argv: string[]; out: NornOut }> = [];
  let filesBefore: Record<string, string>;
  let filesAfter: Record<string, string>;
  let homeBefore: Record<string, string>;
  let homeAfter: Record<string, string>;
  let statusJson: NornOut;
  let statusMd: NornOut;
  let interval: NornOut;
  let intakeView: NornOut;
  let unknownView: NornOut;
  let sliceView: NornOut;
  let view: NornOut;
  let viewMd: NornOut;
  let worktree: string | null = null;

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { workflow: "gated", workflows: { gated: GATED } });
    blank = await norn(w, ["story", "create", "   ", "--json"]);
    untitled = await norn(w, ["story", "create", "--json"]);
    statusAfterBadCreates = (await status(w)) as unknown as { stories: unknown[]; intake: unknown[] };
    gitAfterBadCreates = await sh(w.root, "git", "status", "--porcelain");
    unknownWorkflow = await norn(w, ["story", "create", "Nope", "--workflow", "nope", "--json"]);
    unknownWorkflowMd = await norn(w, ["story", "create", "Nope", "--workflow", "nope"]);

    await person(w, "story", "create", "Look at it");
    intakeView = await norn(w, ["story", "view", KEY, "--json"]);
    await tickUntil(w, rules, parkedAt("look"));

    filesBefore = snapshot(w.root);
    homeBefore = snapshot(w.home);
    for (const argv of [["run", "list"], ["run", "view", KEY], ["story", "reset", KEY], ["story", "edit", KEY], ["story", "chat", KEY], ["why", KEY], ["inbox"]]) removed.push({ argv, out: await norn(w, [...argv, "--json"]) });
    filesAfter = snapshot(w.root);
    homeAfter = snapshot(w.home);

    statusJson = await norn(w, ["status", "--json"]);
    statusMd = await norn(w, ["status"]);
    interval = await norn(w, ["status", "--interval", "5", "--json"]);
    unknownView = await norn(w, ["story", "view", "lt-9", "--json"]);
    sliceView = await norn(w, ["story", "view", `${KEY}/01`, "--json"]);
    view = await norn(w, ["story", "view", KEY, "--json"]);
    viewMd = await norn(w, ["story", "view", KEY]);
    worktree = await worktreeOf(w);
  }, SLOW);

  test("a blank title or none is a usage error, exit 2, and creates nothing", () => {
    expect(blank.code).toBe(2);
    expect(blank.body).toMatchObject({ code: "usage", error: "an empty title" });
    expect(untitled.code).toBe(2);
    expect(untitled.body).toMatchObject({ code: "usage", do_instead: expect.stringContaining("norn story create <title>") });
    expect(statusAfterBadCreates).toMatchObject({ stories: [], intake: [] });
    expect(gitAfterBadCreates).toBe("");
  });

  test("an unknown workflow is refused naming the workflows that load and the repo file that would add it", () => {
    expect(unknownWorkflow.code).toBe(3);
    expect(unknownWorkflow.body).toMatchObject({ code: "unknown_workflow", error: "no workflow nope" });
    expect(unknownWorkflow.body.do_instead).toBe("name one of e2e, gated, or write .agents/workflows/nope.yaml");
    expect(unknownWorkflowMd.code).toBe(3);
    expect(unknownWorkflowMd.stdout).toContain(".agents/workflows/nope.yaml");
  });

  test("story view on an item no tick took yet says so and names the tick", () => {
    expect(intakeView.code).toBe(3);
    expect(intakeView.body).toMatchObject({ code: "story_not_started", do_instead: "norn tick" });
  });

  test("a removed command name exits 2 naming the verbs there are, and writes nothing in the repo or the norn home", () => {
    for (const { argv, out } of removed) {
      expect({ argv, code: out.code, error: out.body.code }).toEqual({ argv, code: 2, error: "unknown_command" });
      expect(String(out.body.do_instead)).toStartWith("norn help");
    }
    expect(filesAfter).toEqual(filesBefore);
    expect(homeAfter).toEqual(homeBefore);
  });

  test("status --json is one JSON value, its markdown leads with what needs the person, and --interval alone is a usage error", () => {
    expect(statusJson.code).toBe(0);
    expect(Bun.JSONL.parse(statusJson.stdout)).toHaveLength(1);
    expect(statusMd.stdout).toContain("## Needs you\n\n- lt-1: look (gate) — waits for gate: Look at it.");
    expect(statusMd.stdout.indexOf("## Needs you")).toBeLessThan(statusMd.stdout.indexOf("## Stories"));
    expect(interval.code).toBe(2);
    expect(interval.body).toMatchObject({ code: "usage", do_instead: "norn status --watch" });
  });

  test("story view refuses a key no store holds, and a slice the story lacks, naming where to look", () => {
    expect(unknownView.code).toBe(3);
    expect(unknownView.body).toMatchObject({ code: "story_not_found", do_instead: "norn story list" });
    expect(sliceView.code).toBe(3);
    expect(sliceView.body).toMatchObject({ code: "story_not_found", do_instead: `norn story view ${KEY}` });
  });

  test("story view names the unit's worktree, which lives in the norn home and never beside the repo", () => {
    expect(worktree).not.toBeNull();
    expect((view.body.units as Array<{ worktree: string | null }>)[0]?.worktree).toBe(worktree as string);
    expect(viewMd.stdout).toContain(`  - worktree: ${worktree}`);
    expect((worktree as string).startsWith(`${w.home}/`)).toBe(true);
    expect(readdirSync(w.dir).filter((f) => f.endsWith("-worktrees"))).toEqual([]);
  });
});

describe("workflows that cannot run", () => {
  let w: World;
  let doctorOk: NornOut;
  let doctorMissing: NornOut;
  let createMissing: NornOut;
  let tickMissing: NornOut;
  let doctorSkill: NornOut;
  let tickSkill: NornOut;
  let tickSkillAdded: NornOut;

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { workflow: "gated", workflows: { gated: GATED, uses: USES } });
    const shared = join(w.root, ".agents", "workflows", "shared");
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, "ask.yaml"), SHARED_ASK);
    doctorOk = await norn(w, ["doctor", "--json"]);
    rmSync(join(shared, "ask.yaml"));
    doctorMissing = await norn(w, ["doctor", "--json"]);
    createMissing = await norn(w, ["story", "create", "Ask it", "--workflow", "uses", "--json"]);
    tickMissing = await norn(w, ["tick", "--json"]);
    rmSync(join(w.root, ".agents", "workflows", "uses.yaml"));
    writeFileSync(join(w.root, ".agents", "workflows", "skilled.yaml"), SKILLED.replace("[norn-tdd, house-style]", "[no-such-skill]"));
    doctorSkill = await norn(w, ["doctor", "--json"]);
    tickSkill = await norn(w, ["tick", "--json"]);
    mkdirSync(join(w.root, ".agents", "skills", "no-such-skill"), { recursive: true });
    writeFileSync(join(w.root, ".agents", "skills", "no-such-skill", "SKILL.md"), "---\nname: no-such-skill\ndescription: the repo's own\n---\n");
    tickSkillAdded = await norn(w, ["tick", "--json"]);
  }, SLOW);

  test("doctor passes while the shared file is there", () => {
    expect(doctorOk.code).toBe(0);
    expect(checkOf(doctorOk, "workflows")).toMatchObject({ ok: true, detail: expect.stringContaining("uses") });
  });

  test("a missing shared file fails doctor's workflows check naming it, and story create on the workflow using it exits 3 saying why", () => {
    expect(doctorMissing.code).toBe(1);
    expect(checkOf(doctorMissing, "workflows")).toMatchObject({ ok: false, code: "repo_workflow_invalid", error: expect.stringContaining("shared/ask.yaml") });
    expect(createMissing.code).toBe(3);
    expect(createMissing.body).toMatchObject({ code: "invalid_workflow", error: expect.stringContaining("shared/ask.yaml"), do_instead: "fix .agents/workflows/uses.yaml, then norn doctor" });
    expect(tickMissing.code).toBe(3);
    expect(tickMissing.body).toMatchObject({ code: "repo_workflow_invalid" });
  });

  test("a repo workflow naming a skill nobody has is named by doctor and refused by the tick, until the repo adds it", () => {
    expect(doctorSkill.code).toBe(1);
    expect(checkOf(doctorSkill, "workflows")).toMatchObject({ ok: false, code: "unknown_skill", error: expect.stringContaining("no-such-skill (step build)") });
    expect(tickSkill.code).toBe(3);
    expect(tickSkill.body).toMatchObject({ code: "unknown_skill", details: { files: [".agents/workflows/skilled.yaml"], skills: ["no-such-skill"] } });
    expect(String(tickSkill.body.do_instead)).toContain(".agents/skills/no-such-skill/SKILL.md");
    expect(tickSkillAdded.code).toBe(0);
  });
});

describe("pack skills: doctor repairs a drifted copy, and a launch keeps the repo's own", () => {
  let w: World;
  const rules: string[] = [];
  let drifted: NornOut;
  let repaired = "";
  let worktree = "";
  let ownAtLaunch = "";
  let packAtLaunch = "";
  let markAtLaunch = "";
  let worktreeStatus = "";
  const ownText = "---\nname: norn-review\ndescription: this repo reviews its own way\n---\n\nReview it our way.\n";

  beforeAll(async () => {
    w = await world("hang");
    await setUp(w, { mode: "manual", workflow: "skilled", workflows: { skilled: SKILLED }, config: [["packs", "[sdlc]"]] });
    // the repo keeps two skills of its own, committed: one the pack lacks, one in place of the pack's
    for (const [name, text] of [["house-style", "---\nname: house-style\ndescription: how this repo writes code\n---\n"], ["norn-review", ownText]] as const) {
      mkdirSync(join(w.root, ".agents", "skills", name), { recursive: true });
      writeFileSync(join(w.root, ".agents", "skills", name, "SKILL.md"), text);
    }
    rmSync(join(w.root, ".agents", "skills", "norn-review", ".gitignore"), { force: true });
    await sh(w.root, "git", "add", "-f", ".agents/skills/house-style", ".agents/skills/norn-review", ".agents/workflows");
    await sh(w.root, "git", "commit", "-q", "-m", "the repo's own skills");
    await sh(w.root, "git", "push", "-q", "origin", "main");

    writeFileSync(join(w.root, ".agents", "skills", "norn-tdd", "SKILL.md"), "drifted\n");
    drifted = await norn(w, ["doctor", "--json"]);
    repaired = readFileSync(join(w.root, ".agents", "skills", "norn-tdd", "SKILL.md"), "utf8");

    await person(w, "story", "create", "Build it");
    await tickUntil(w, rules, (u) => u?.parked === "agent.ready.manual");
    worktree = (await worktreeOf(w)) as string;
    // a stale copy under norn's mark in the worktree, as an older pack left it
    mkdirSync(join(worktree, ".agents", "skills", "norn-tdd"), { recursive: true });
    writeFileSync(join(worktree, ".agents", "skills", "norn-tdd", ".gitignore"), `${readFileSync(join(w.root, ".agents", "skills", "norn-tdd", ".gitignore"), "utf8")}`);
    writeFileSync(join(worktree, ".agents", "skills", "norn-tdd", "SKILL.md"), "an older copy\n");
    await person(w, "run", "start", KEY);
    await tickUntil(w, rules, (u) => u?.run !== null && u?.run !== undefined);
    await awaitNote(w, "pid");
    ownAtLaunch = readFileSync(join(worktree, ".agents", "skills", "norn-review", "SKILL.md"), "utf8");
    packAtLaunch = readFileSync(join(worktree, ".agents", "skills", "norn-tdd", "SKILL.md"), "utf8");
    markAtLaunch = readFileSync(join(worktree, ".agents", "skills", "norn-tdd", ".gitignore"), "utf8");
    worktreeStatus = await sh(worktree, "git", "status", "--porcelain", "--", ".agents/skills");
    await person(w, "story", "close", KEY);
    await tickUntil(w, rules, (u) => u?.ended !== undefined);
  }, SLOW);

  test("doctor rewrites a drifted copy of a pack skill in the main checkout, says it did, and names the repo's own it kept", () => {
    expect(checkOf(drifted, "skills")).toMatchObject({ ok: true, detail: expect.stringContaining("(1 files written or removed); kept the repo's own norn-review") });
    expect(repaired).toBe(readFileSync(join(PACK_SKILLS, "norn-tdd", "SKILL.md"), "utf8"));
  });

  test("a launch rewrites norn's marked copy and keeps the repo's own skill of the same name as a pack skill", () => {
    expect(packAtLaunch).toBe(readFileSync(join(PACK_SKILLS, "norn-tdd", "SKILL.md"), "utf8"));
    expect(markAtLaunch).toStartWith("# norn: pack skills");
    expect(ownAtLaunch).toBe(ownText);
    expect(worktreeStatus).toBe("");
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
  });
});

describe("the config a person breaks, or an old norn left", () => {
  let w: World;
  let statusBroken: NornOut;
  let listBroken: NornOut;
  let statusOld: NornOut;
  let init: NornOut;
  let backup = "";
  let rewritten = "";
  let mode: NornOut;
  let tick: NornOut;
  const old = "mode: manual\nmax_agents: 3\nnotify: { desktop: true }\n";

  beforeAll(async () => {
    w = await world("work");
    await setUp(w);
    const local = join(w.root, REPO_LOCAL_FILE);
    const good = readFileSync(local, "utf8");
    writeFileSync(local, `${good}kernel: [broken\n`);
    statusBroken = await norn(w, ["status", "--json"]);
    listBroken = await norn(w, ["story", "list"]);
    writeFileSync(local, good);
    writeFileSync(join(w.home, "config.yaml"), old);
    statusOld = await norn(w, ["status", "--json"]);
    init = await norn(w, ["init", "--yes", "--json"]);
    backup = existsSync(join(w.home, "config.yaml.old")) ? readFileSync(join(w.home, "config.yaml.old"), "utf8") : "";
    rewritten = readFileSync(join(w.home, "config.yaml"), "utf8");
    mode = await norn(w, ["config", "get", "kernel.mode", "--json"]);
    tick = await norn(w, ["tick", "--json"]);
  }, SLOW);

  test("a config file that does not parse stops status and story list with exit 6, naming the file", () => {
    expect(statusBroken.code).toBe(6);
    expect(statusBroken.body).toMatchObject({ code: "config_invalid", do_instead: `fix ${REPO_LOCAL_FILE}`, error: expect.stringContaining(REPO_LOCAL_FILE) });
    expect(listBroken.code).toBe(6);
    expect(listBroken.stdout).toStartWith(`**Config error (config_invalid):** ${REPO_LOCAL_FILE}`);
  });

  test("the old norn's user config is refused as config_old, naming init", () => {
    expect(statusOld.code).toBe(6);
    expect(statusOld.body).toMatchObject({ code: "config_old", do_instead: expect.stringContaining("norn init") });
  });

  test("init rewrites it in this norn's keys, keeps the old text beside it, and the next commands run", () => {
    expect(init.code).toBe(0);
    expect(init.body.user_migrated).toMatchObject({ mapped: ["mode → kernel.mode"], backup: join(w.home, "config.yaml.old") });
    expect(backup).toBe(old);
    expect(rewritten).toContain("mode: manual");
    expect(rewritten).not.toContain("max_agents");
    // the repo's file sets the mode too, and wins over the user's
    expect(mode.body).toMatchObject({ key: "kernel.mode", value: "auto", source: "local" });
    expect(tick.code).toBe(0);
  });
});

describe("two repos sharing one norn home", () => {
  let a: World;
  let b: World;
  let modeA: NornOut;
  let modeB: NornOut;
  let machines: string[] = [];

  beforeAll(async () => {
    a = await world("work");
    await setUp(a, { mode: "auto" });
    const other = await world("work");
    b = { ...other, home: a.home, env: { ...other.env, NORN_HOME_DIR: a.home } };
    await setUp(b, { mode: "manual" });
    modeA = await norn(a, ["config", "get", "kernel.mode", "--json"]);
    modeB = await norn(b, ["config", "get", "kernel.mode", "--json"]);
    machines = readdirSync(join(a.home, "repos"));
  }, SLOW);

  test("each repo keeps its own kernel.mode, from its own repo-local file", () => {
    expect(modeA.body).toEqual({ key: "kernel.mode", value: "auto", source: "local", file: join(a.root, REPO_LOCAL_FILE) });
    expect(modeB.body).toEqual({ key: "kernel.mode", value: "manual", source: "local", file: join(b.root, REPO_LOCAL_FILE) });
  });

  test("the home keeps a machine dir per repo", () => {
    expect(machines).toHaveLength(2);
  });
});
