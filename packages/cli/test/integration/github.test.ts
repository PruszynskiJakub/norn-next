/**
 * The GitHub tracker and forge over a fake `gh` on PATH (fixtures/fake-gh): labels defined at init
 * and by doctor, items created and taken in, a story's PR opened, retitled, waited on and merged,
 * and the shipped CI checks, every norn call a subprocess of the binary from source.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nodeExec } from "@norn/host-node";
import { parse } from "yaml";
import { callsOf, editGh, fakeGh, type GhPr, type GhState, ghCalls, ghState, LOGIN, openPr, pushes, visibleBody, WEB } from "./fake-gh.ts";
import { agentNotes, type NornOut, norn, setUp, sh, status, TEST_PLUGIN, tickUntil, type UnitShown, unitOf, type World, world } from "./world.ts";

const SLOW = 180_000;
const COLOR = "5319E7";

/** Every label norn defines on a fresh repository, as `norn doctor --json` counts them. */
function labelsDefined(doctor: NornOut): number {
  const checks = doctor.body.checks as { name: string; ok: boolean; detail?: string }[];
  const labels = checks.find((c) => c.name === "labels");
  return Number(/(\d+) labels defined/.exec(labels?.detail ?? "")?.[1] ?? -1);
}

describe("labels on a GitHub repository", () => {
  let w: World;
  let init: NornOut;
  let createsAtInit: string[][] = [];
  let doctorAgain: NornOut;
  let createsAfterDoctor: string[][] = [];
  let repoDoctor: string[][] = [];
  let newWorkflow: string[][] = [];
  let created: NornOut;
  let createCalls: string[][] = [];
  let intakeBeforeTick: unknown;
  let tickLabelCalls: string[][] = [];
  let initAgain: NornOut;
  let createsAtInitAgain: string[][] = [];

  beforeAll(async () => {
    w = await world("work");
    fakeGh(w);
    ({ init } = await setUp(w, { tracker: "github", forge: "github" }));
    createsAtInit = callsOf(ghCalls(w), "label create");

    // the e2e pack setUp adds is a workflow init did not see: the first doctor defines its label
    await norn(w, ["doctor", "--json"]);
    let before = ghCalls(w).length;
    doctorAgain = await norn(w, ["doctor", "--json"]);
    createsAfterDoctor = callsOf(ghCalls(w).slice(before), "label create");

    before = ghCalls(w).length;
    await norn(w, ["doctor", "--repo", "--json"]);
    repoDoctor = ghCalls(w).slice(before);

    mkdirSync(join(w.root, ".agents", "workflows"), { recursive: true });
    writeFileSync(join(w.root, ".agents", "workflows", "mine.yaml"), ["name: mine", "start: look", "steps:", "  look:", "    gate: Look.", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n"));
    writeFileSync(join(w.root, ".agents", "workflows", "broken.yaml"), "name: broken\nstart: nowhere\nsteps: {}\n");
    before = ghCalls(w).length;
    await norn(w, ["doctor", "--json"]);
    newWorkflow = callsOf(ghCalls(w).slice(before), "label create");

    before = ghCalls(w).length;
    created = await norn(w, ["story", "create", "Make it", "--workflow", "mine", "--json"]);
    createCalls = ghCalls(w).slice(before);
    intakeBeforeTick = (await norn(w, ["status", "--json"])).body.stories;

    before = ghCalls(w).length;
    for (let i = 0; i < 3; i++) await norn(w, ["tick", "--json"]);
    tickLabelCalls = ghCalls(w)
      .slice(before)
      .filter((c) => c[0] === "label" || (c[0] === "issue" && c[1] === "edit"));

    before = ghCalls(w).length;
    initAgain = await norn(w, ["init", "--tracker", "github", "--forge", "github", "--store", "local", "--executor", "test", "--runner", "headless", "--yes", "--json"]);
    createsAtInitAgain = callsOf(ghCalls(w).slice(before), "label create");
  }, SLOW);

  test("init defines every norn label once, in norn's colour with a description", () => {
    expect(init.code).toBe(0);
    expect(createsAtInit.length).toBeGreaterThan(0);
    expect(createsAtInit.length).toBe(labelsDefined({ body: init.body.doctor } as NornOut));
    for (const c of createsAtInit) {
      expect(c[c.indexOf("--color") + 1]).toBe(COLOR);
      expect(c[c.indexOf("--description") + 1]).not.toBe("");
    }
    expect(createsAtInit.map((c) => c[2])).toEqual(expect.arrayContaining(["norn", "norn:wf:quick", "norn:kind:bug"]));
    expect(new Set(createsAtInit.map((c) => c[2])).size).toBe(createsAtInit.length);
  });

  test("doctor on a repository whose labels are defined creates none, and a second init, refused, creates none either", () => {
    expect(doctorAgain.code).toBe(0);
    expect(createsAfterDoctor).toEqual([]);
    expect(initAgain.code).toBe(3);
    expect(initAgain.body).toMatchObject({ code: "already_initialized" });
    expect(createsAtInitAgain).toEqual([]);
  });

  test("doctor --repo makes no gh label call", () => {
    expect(repoDoctor.filter((c) => c[0] === "label")).toEqual([]);
  });

  test("a new repo workflow gets exactly one label from doctor, a broken one none", () => {
    expect(newWorkflow.map((c) => c[2])).toEqual(["norn:wf:mine"]);
  });

  test("story create labels and assigns the issue, defining its labels before it, and intake waits for a tick", () => {
    expect(created.code).toBe(0);
    expect(created.body).toMatchObject({ key: "gh-1", labels: ["norn", "norn:wf:mine"], assignee: LOGIN });
    const issue = ghState(w).issues.find((i) => i.number === 1);
    expect(issue).toMatchObject({ labels: ["norn", "norn:wf:mine"], assignees: [LOGIN] });
    const order = createCalls.map((c) => `${c[0]} ${c[1]}`);
    expect(order.indexOf("label list")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("label list")).toBeLessThan(order.indexOf("issue create"));
    expect(intakeBeforeTick).toEqual([]);
  });

  test("a tick never creates or edits a label", () => {
    expect(tickLabelCalls).toEqual([]);
  });
});

interface Check {
  name: string;
  ok: boolean;
  error?: string;
  do_instead?: string;
  code?: string;
}
const checkOf = (doctor: unknown, name: string): Check | undefined => ((doctor as { checks?: Check[] }).checks ?? []).find((c) => c.name === name);

describe("GitHub refusing norn", () => {
  let w: World;
  let doctor403: NornOut;
  let create403: NornOut;
  let calls403: string[][] = [];
  let create401: NornOut;
  let issuesAfter401: number;
  let storiesAfter401: unknown;
  let loggedOut: World;
  let initLoggedOut: NornOut;
  let configLoggedOut: NornOut;

  beforeAll(async () => {
    w = await world("work");
    fakeGh(w);
    await setUp(w, { tracker: "github", forge: "github" });
    await norn(w, ["doctor", "--json"]);

    // a token that may not create labels, and a workflow whose label is not defined yet
    editGh(w, (s) => {
      s.fail["label create"] = { code: 1, stderr: "HTTP 403: Resource not accessible by integration (https://api.github.com/repos/acme/app/labels)" };
    });
    mkdirSync(join(w.root, ".agents", "workflows"), { recursive: true });
    writeFileSync(join(w.root, ".agents", "workflows", "mine.yaml"), ["name: mine", "start: look", "steps:", "  look:", "    gate: Look.", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n"));
    doctor403 = await norn(w, ["doctor", "--json"]);
    const before = ghCalls(w).length;
    create403 = await norn(w, ["story", "create", "Make it", "--workflow", "mine", "--json"]);
    calls403 = ghCalls(w).slice(before);

    editGh(w, (s) => {
      s.fail = { "issue create": { code: 1, stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)" } };
    });
    create401 = await norn(w, ["story", "create", "Make it", "--json"]);
    issuesAfter401 = ghState(w).issues.length;
    await norn(w, ["tick", "--json"]);
    storiesAfter401 = (await norn(w, ["status", "--json"])).body.stories;

    loggedOut = await world("work");
    fakeGh(loggedOut);
    editGh(loggedOut, (s) => {
      s.fail["*"] = { code: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login" };
    });
    await norn(loggedOut, ["plugin", "add", TEST_PLUGIN, "--json"]);
    initLoggedOut = await norn(loggedOut, ["init", "--tracker", "github", "--forge", "github", "--store", "local", "--executor", "test", "--runner", "headless", "--yes", "--json"]);
    configLoggedOut = await norn(loggedOut, ["config", "get", "tracker.use", "--json"]);
  }, SLOW);

  test("labels it may not create fail doctor's labels check, and story create fails before any issue", () => {
    expect(checkOf(doctor403.body, "labels")).toMatchObject({ ok: false, code: "labels_undefined" });
    // GitHub refused, not norn: a failure (exit 1), the code naming what is missing
    expect(create403.code).toBe(1);
    expect(create403.body).toMatchObject({ code: "labels_undefined" });
    expect(String(create403.body.error)).toContain("norn:wf:mine");
    expect(callsOf(calls403, "issue create")).toEqual([]);
  });

  test("a 401 on issue create names it and norn doctor, and leaves no issue and no story", () => {
    expect(create401.code).toBe(1);
    expect(String(create401.body.error)).toContain("HTTP 401");
    expect(String(create401.body.do_instead)).toContain("norn doctor");
    expect(issuesAfter401).toBe(0);
    expect(storiesAfter401).toEqual([]);
  });

  test("with gh logged out init still writes the config, and its doctor names gh auth login", () => {
    expect(initLoggedOut.body.file).toEqual(expect.any(String));
    expect(configLoggedOut.code).toBe(0);
    expect(JSON.stringify(configLoggedOut.body)).toContain("github");
    expect(checkOf(initLoggedOut.body.doctor, "gh auth")).toMatchObject({ ok: false, do_instead: "gh auth login", code: "gh_logged_out" });
  });
});

const gateOnly = (name: string, step: string) => [`name: ${name}`, `start: ${step}`, "steps:", `  ${step}:`, "    gate: Look.", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n");

describe("intake from GitHub issues", () => {
  let w: World;
  const rules: string[] = [];
  let labelled: UnitShown | null;
  let bare: UnitShown | null;
  let others: string[] = [];
  let afterRelabel: UnitShown | null;
  let viewAfterRelabel: NornOut;

  beforeAll(async () => {
    w = await world("work");
    fakeGh(w);
    // the repo's own quick replaces the pack's: a story labelled for quick starts at its step
    await setUp(w, { tracker: "github", forge: "github", workflow: "plain", workflows: { quick: gateOnly("quick", "custom"), plain: gateOnly("plain", "wait") } });
    await norn(w, ["doctor", "--json"]);
    editGh(w, (s) => {
      const issue = (number: number, labels: string[], assignees: string[]) => ({ number, title: `Issue ${number}`, body: "", open: true, assignees, labels, author: "someone", comments: [] });
      s.issues = [issue(1, ["norn", "norn:wf:quick"], [LOGIN]), issue(2, ["norn"], [LOGIN]), issue(3, ["norn"], ["someone-else"]), issue(4, ["bug"], [LOGIN])];
    });
    await tickUntil(w, rules, (u) => u?.parked !== undefined, 60_000, "gh-1");
    await tickUntil(w, rules, (u) => u?.parked !== undefined, 60_000, "gh-2");
    labelled = await unitOf(w, "gh-1");
    bare = await unitOf(w, "gh-2");
    others = (await status(w)).stories.map((st) => st.key).filter((k) => k !== "gh-1" && k !== "gh-2");

    editGh(w, (s) => {
      const one = s.issues.find((i) => i.number === 1);
      if (one) one.labels = ["norn", "norn:wf:plain"];
    });
    for (let i = 0; i < 2; i++) await norn(w, ["tick", "--json"]);
    afterRelabel = await unitOf(w, "gh-1");
    viewAfterRelabel = await norn(w, ["story", "view", "gh-1", "--json"]);
  }, SLOW);

  test("an issue labelled for a workflow takes the repo's copy of it; a bare one takes the default", () => {
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(labelled?.step).toBe("custom");
    expect(bare?.step).toBe("wait");
  });

  test("an issue without the intake label, or assigned to someone else, is not taken in", () => {
    expect(others).toEqual([]);
  });

  test("a workflow label changed after intake changes nothing", () => {
    expect(afterRelabel?.step).toBe("custom");
    expect((viewAfterRelabel.body.units as { id: string; workflow: string | null }[]).find((u) => u.id === "gh-1")?.workflow).toBe("quick");
  });
});

const SHIP = readFileSync(join(import.meta.dir, "..", "..", "..", "pack-sdlc", "assets", "workflows", "shared", "ship.yaml"), "utf8");
const FLOW = [
  "name: flow",
  "start: build",
  "steps:",
  "  build:",
  "    agent: Build the thing.",
  "    inputs: [last_check]",
  "    outcomes: { done: ship }",
  "  ship:",
  "    use: ship",
  "    outcomes: { ci-failed: build, rejected: build, stale: build }",
  "",
].join("\n");

/** The repo's flow workflow with the pack's shared ship steps beside it, as a repo copies them. */
function writeFlow(w: World): void {
  mkdirSync(join(w.root, ".agents", "workflows", "shared"), { recursive: true });
  writeFileSync(join(w.root, ".agents", "workflows", "flow.yaml"), FLOW);
  writeFileSync(join(w.root, ".agents", "workflows", "shared", "ship.yaml"), SHIP);
}

const KEY = "gh-1";
/** The receipts a story's own unit holds that no tick applied yet, as `story view --json` counts them. */
const pendingOf = (view: NornOut): number => ((view.body.units as { id: string; pending_receipts: number }[]).find((u) => u.id === KEY)?.pending_receipts ?? -1);
const BRANCH = `norn/${KEY}`;
const storyPushes = (w: World) => pushes(w).filter((l) => l.startsWith(`refs/heads/${BRANCH} `));

describe("a story's pull request on GitHub", () => {
  let w: World;
  const rules: string[] = [];
  let pushesBeforePr = -1;
  let reworkBrief = "";
  let atReady: { pr: GhPr | undefined; prCreates: number; pushes: number };
  let atMerge: { url: unknown; remote: string; local: string; pushes: number; draft: boolean | undefined; readies: number };
  let approveAtMerge: NornOut;
  let rejectAtMerge: NornOut;
  let stillAtMerge: UnitShown | null;
  let editsOnPlainTicks: string[][] = [];
  let specOnly: { pushes: number; edits: string[][]; step: string | null };
  let unpushedRules: string[] = [];
  let receiptsByRefusals = -1;
  let mergeView: NornOut;
  let mergedView: NornOut;
  let reopened: { edits: string[][]; title: string | undefined; body: string; pushes: number; step: string | null };
  let ended: UnitShown | null;
  let mergedRules: string[] = [];
  let view: NornOut;
  let prCreates = 0;
  const MERGE_SHA = "f".repeat(40);

  beforeAll(async () => {
    w = await world("work");
    fakeGh(w);
    await setUp(w, { tracker: "github", forge: "github" });
    writeFlow(w);
    await norn(w, ["doctor", "--json"]);
    editGh(w, (s) => {
      s.issues = [{ number: 1, title: "Ship the thing", body: "", open: true, assignees: [LOGIN], labels: ["norn", "norn:wf:flow"], author: LOGIN, comments: [] }];
      s.newPr = { checks: "failure" };
    });

    await tickUntil(w, rules, (u) => u?.step === "ci", 90_000, KEY);
    pushesBeforePr = pushes(w).filter((l) => l.startsWith(`refs/heads/${BRANCH} `)).length;
    await tickUntil(w, rules, (u) => u?.step === "build", 90_000, KEY);
    // the rework's CI goes green
    editGh(w, (s) => {
      for (const p of s.prs) p.checks = "success";
    });
    await tickUntil(w, rules, (u) => u?.step === "ready" && u.parked !== undefined, 90_000, KEY);
    // the second brief at build is the rework's
    const briefs = agentNotes(w).filter((n) => n.note === "brief" && String((n.value as { text?: string }).text ?? "").includes("Build the thing."));
    reworkBrief = String((briefs[1]?.value as { text?: string } | undefined)?.text ?? "");
    atReady = { pr: openPr(w, BRANCH), prCreates: callsOf(ghCalls(w), "pr create").length, pushes: storyPushes(w).length };

    await norn(w, ["story", "approve", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "merge", 60_000, KEY);
    const shown = (await status(w)).stories.find((st) => st.key === KEY) as unknown as { change?: { url?: string } };
    // the merge step's first poll marks the draft ready, so a person can merge it
    await norn(w, ["tick", "--json"]);
    atMerge = {
      url: shown.change?.url,
      remote: await sh(w.remote, "git", "rev-parse", BRANCH),
      local: await sh(w.root, "git", "rev-parse", BRANCH),
      pushes: storyPushes(w).length,
      draft: openPr(w, BRANCH)?.draft,
      readies: callsOf(ghCalls(w), "pr ready").length,
    };
    mergeView = await norn(w, ["story", "view", KEY]);
    const pendingBefore = pendingOf(await norn(w, ["story", "view", KEY, "--json"]));
    approveAtMerge = await norn(w, ["story", "approve", KEY, "--json"]);
    rejectAtMerge = await norn(w, ["story", "reject", KEY, "--reason", "no", "--json"]);
    receiptsByRefusals = pendingOf(await norn(w, ["story", "view", KEY, "--json"])) - pendingBefore;

    editGh(w, (s) => {
      const issue = s.issues.find((i) => i.number === 1);
      if (issue) issue.title = "Ship the renamed thing";
    });
    let before = ghCalls(w).length;
    for (let i = 0; i < 3; i++) await norn(w, ["tick", "--json"]);
    editsOnPlainTicks = callsOf(ghCalls(w).slice(before), "pr edit");
    stillAtMerge = await unitOf(w, KEY);

    const wt = await worktreeOf(w, KEY);
    if (!wt) throw new Error("the story has no worktree at merge");
    // a commit touching only the story's spec folder stays local: it is no change the PR lacks
    mkdirSync(join(wt, ".agents", "specs", KEY), { recursive: true });
    writeFileSync(join(wt, ".agents", "specs", KEY, "notes.md"), "a note\n");
    await sh(wt, "git", "add", "-f", join(".agents", "specs", KEY, "notes.md"));
    await sh(wt, "git", "commit", "-q", "-m", "spec note");
    before = ghCalls(w).length;
    let pushesBefore = storyPushes(w).length;
    for (let i = 0; i < 3; i++) await norn(w, ["tick", "--json"]);
    specOnly = { pushes: storyPushes(w).length - pushesBefore, edits: callsOf(ghCalls(w).slice(before), "pr edit"), step: (await unitOf(w, KEY))?.step ?? null };

    // a code commit on the story branch the PR lacks sends the story back through open-pr
    writeFileSync(join(wt, "code.txt"), "more code\n");
    writeFileSync(join(wt, ".agents", "specs", KEY, "pr.md"), "# Ship it\n\nWhat changed.\n");
    // pr.md is read from the worktree: init keeps .agents/ out of git in a repo that does not commit it
    await sh(wt, "git", "add", "code.txt");
    await sh(wt, "git", "commit", "-q", "-m", "more code");
    before = ghCalls(w).length;
    pushesBefore = storyPushes(w).length;
    const rulesBefore = rules.length;
    await tickUntil(w, rules, (u) => u?.step === "ready" && u.parked !== undefined, 90_000, KEY);
    unpushedRules = rules.slice(rulesBefore);
    reopened = { edits: callsOf(ghCalls(w).slice(before), "pr edit"), title: openPr(w, BRANCH)?.title, body: visibleBody(openPr(w, BRANCH)?.body ?? ""), pushes: storyPushes(w).length - pushesBefore, step: (await unitOf(w, KEY))?.step ?? null };

    // a person squash-merges the PR while the story waits at its gate
    editGh(w, (s) => {
      for (const p of s.prs) Object.assign(p, { state: "MERGED", mergeSha: MERGE_SHA, mergedAt: "2026-10-21T10:00:00Z" });
    });
    before = rules.length;
    await tickUntil(w, rules, (u) => u?.ended !== undefined, 60_000, KEY);
    mergedRules = rules.slice(before);
    ended = await unitOf(w, KEY);
    view = await norn(w, ["story", "view", KEY, "--json"]);
    mergedView = await norn(w, ["story", "view", KEY]);
    prCreates = callsOf(ghCalls(w), "pr create").length;
  }, 400_000);

  test("the branch is pushed first at open-pr, and the draft PR's body is the issue link alone when there is no pr.md", () => {
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(pushesBeforePr).toBe(1);
    expect(atReady.prCreates).toBe(1);
    expect(atReady.pr).toMatchObject({ head: BRANCH, base: "main", title: "Ship the thing", draft: true });
    expect(visibleBody(atReady.pr?.body ?? "")).toBe(`Closes ${WEB}/issues/1\n\nDelivered by norn (story ${KEY}).`);
  });

  test("a red CI sends the story back to build with the failing check's URL in its brief, and its rework is pushed through open-pr again", () => {
    expect(reworkBrief).toContain(`${WEB}/actions/runs/1/job/7`);
    expect(atReady.pushes).toBe(2);
  });

  test("at merge the draft PR is marked ready once, so a person can merge it", () => {
    expect(atMerge.draft).toBe(false);
    expect(atMerge.readies).toBe(1);
  });

  test("at merge, status names the PR's URL, the PR's head is the story's head, and approve pushed nothing", () => {
    expect(atMerge.url).toBe(`${WEB}/pull/2`);
    expect(atMerge.remote).toBe(atMerge.local);
    expect(atMerge.pushes).toBe(atReady.pushes);
  });

  test("approve or reject at merge is refused, and records no gate decision", () => {
    for (const r of [approveAtMerge, rejectAtMerge]) {
      expect(r.code).toBe(3);
      expect(String(r.body.error)).toContain("merge");
    }
    expect(receiptsByRefusals).toBe(0);
    expect(stillAtMerge?.step).toBe("merge");
  });

  test("story view names the PR without a merge commit while it is open", () => {
    expect(mergeView.stdout).toContain(`Change: ${WEB}/pull/2\n`);
    expect(mergeView.stdout).not.toContain("merged as");
  });

  test("a commit touching only the story's spec folder stays local: no push, no PR edit, still at merge", () => {
    expect(specOnly).toEqual({ pushes: 0, edits: [], step: "merge" });
  });

  test("a renamed issue edits no PR on plain ticks; a commit goes back through open-pr, which retitles the PR, sets its body from pr.md and pushes once", () => {
    expect(editsOnPlainTicks).toEqual([]);
    expect(reopened.edits.length).toBe(1);
    expect(reopened.edits[0]).toEqual(expect.arrayContaining(["--title", "Ship the renamed thing", "--body-file", "-"]));
    expect(reopened.title).toBe("Ship the renamed thing");
    expect(reopened.body).toBe(`# Ship it\n\nWhat changed.\n\n---\n\nCloses ${WEB}/issues/1\n\nDelivered by norn (story ${KEY}).`);
    expect(reopened.pushes).toBe(1);
    expect(reopened.step).toBe("ready");
    expect(unpushedRules).toContain("step.unpushed");
  });

  test("a squash merge at the gate ends the story done through change_merged, with one PR in all and its merge sha on record", () => {
    expect(mergedRules).toContain("story.change_merged");
    expect(mergedRules).not.toContain("gate.stale");
    expect(ended?.ended).toBe("done");
    expect(prCreates).toBe(1);
    expect(JSON.stringify(view.body)).toContain(MERGE_SHA);
    expect(mergedView.stdout).toContain(`Change: ${WEB}/pull/2 (merged as ${MERGE_SHA.slice(0, 12)})`);
  });
});

describe("a new round on a finished story whose PR is still open", () => {
  let w: World;
  const rules: string[] = [];
  let round: NornOut;
  let creates = 0;
  let edits: string[][] = [];
  let body = "";

  beforeAll(async () => {
    w = await world("work");
    fakeGh(w);
    const shipped = ["name: shipped", "start: look", "steps:", "  look:", "    gate: Ship it.", "    outcomes: { approve: open-pr, reject: $stuck }", "  open-pr:", "    open-pr:", "    outcomes: { done: $done }", ""].join("\n");
    await setUp(w, { tracker: "github", forge: "github", workflows: { shipped } });
    await norn(w, ["doctor", "--json"]);
    await norn(w, ["story", "create", "Ship it", "--workflow", "shipped", "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "look" && u.parked !== undefined, 60_000, KEY);
    await norn(w, ["story", "approve", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.ended === "done", 60_000, KEY);
    await tickUntil(w, rules, () => rules.includes("claim.release"), 60_000, KEY);

    round = await norn(w, ["story", "round", KEY, "--workflow", "shipped", "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "look" && u.parked !== undefined && u.ended === undefined, 60_000, KEY);
    const before = ghCalls(w).length;
    await norn(w, ["story", "approve", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.ended === "done", 60_000, KEY);
    creates = callsOf(ghCalls(w), "pr create").length;
    edits = callsOf(ghCalls(w).slice(before), "pr edit");
    body = visibleBody(openPr(w, BRANCH)?.body ?? "");
  }, SLOW);

  test("the round's open-pr edits the open PR's body and opens no second PR", () => {
    expect(round.code).toBe(0);
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(creates).toBe(1);
    expect(edits.length).toBe(1);
    expect(edits[0]).toEqual(expect.arrayContaining(["--body-file", "-"]));
    expect(body).toBe(`Closes ${WEB}/issues/1\n\nDelivered by norn (story ${KEY}).`);
  });
});

/** The story's worktree, as git lists it in the repo. */
async function worktreeOf(w: World, key: string): Promise<string | undefined> {
  return (await sh(w.root, "git", "worktree", "list", "--porcelain"))
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .find((p) => p.endsWith(`/worktrees/${key}`));
}

describe("a story's pull request merged into a branch other than its base", () => {
  let w: World;
  const rules: string[] = [];
  let parked: UnitShown | null;
  let worktree: string | undefined;
  let wtExists = false;

  beforeAll(async () => {
    w = await world("work");
    fakeGh(w);
    const shipped = [
      "name: shipped",
      "start: look",
      "steps:",
      "  look:",
      "    gate: Ship it.",
      "    outcomes: { approve: open-pr, reject: $stuck }",
      "  open-pr:",
      "    open-pr:",
      "    outcomes: { done: merge }",
      "  merge:",
      "    await-merge:",
      "    outcomes: { merged: $done, stale: $stuck, unpushed: open-pr }",
      "",
    ].join("\n");
    await setUp(w, { tracker: "github", forge: "github", workflows: { shipped } });
    await norn(w, ["doctor", "--json"]);
    await norn(w, ["story", "create", "Ship it", "--workflow", "shipped", "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "look" && u.parked !== undefined, 60_000, KEY);
    await norn(w, ["story", "approve", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "merge", 60_000, KEY);

    // a person retargets the PR to release on github.com and merges it there
    editGh(w, (s) => {
      for (const p of s.prs) Object.assign(p, { base: "release", state: "MERGED", mergeSha: "e".repeat(40), mergedAt: "2026-10-21T10:00:00Z" });
    });
    await tickUntil(w, rules, (u) => u?.parked !== undefined || u?.ended !== undefined, 60_000, KEY);
    for (let i = 0; i < 2; i++) await norn(w, ["tick", "--json"]);
    parked = await unitOf(w, KEY);
    worktree = await worktreeOf(w, KEY);
    wtExists = worktree !== undefined && existsSync(worktree);
  }, SLOW);

  test("the story is not ended done: it parks naming release, and its worktree stays", () => {
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(rules).not.toContain("story.change_merged");
    expect(parked?.ended).toBeUndefined();
    expect(parked?.step).toBe("merge");
    expect(parked?.parked).toContain("release");
    expect(wtExists).toBe(true);
  });
});

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
/** A file of this repo the CI scripts are read from; one that moved names itself rather than failing on a bare read error. */
function repoFile(...parts: string[]): string {
  const file = join(REPO_ROOT, ...parts);
  if (!existsSync(file)) throw new Error(`the CI script tests read ${parts.join("/")} from this repo, and it is gone: point them at where it moved`);
  return file;
}
/** A workflow's `ci` check script, read from the file as the workflow loader reads it. */
const ciScript = (file: string): string => ((parse(readFileSync(file, "utf8")) as { steps: { ci: { check: string } } }).steps.ci.check);

interface ScriptRun {
  code: number;
  stdout: string;
  calls: string[][];
}

/**
 * The CI wait scripts run as the check runner runs them, in the story's checkout on its branch with
 * the fake gh on PATH, one scripted PR state per case.
 */
describe("the CI check scripts over the fake gh", () => {
  let w: World;
  const runs: Record<string, ScriptRun> = {};

  async function run(name: string, file: string, pr: Partial<GhPr>, opts: { path?: string; fail?: GhState["fail"] } = {}): Promise<void> {
    editGh(w, (s) => {
      s.fail = opts.fail ?? {};
      s.prs = [{ number: 2, head: BRANCH, base: "main", title: "t", body: "", draft: true, state: "OPEN", mergeable: "MERGEABLE", checks: "none", run: null, ...pr }];
    });
    const before = ghCalls(w).length;
    const r = await nodeExec(["/bin/sh", "-c", ciScript(file)], { cwd: w.root, env: { ...w.env, ...(opts.path !== undefined && { PATH: opts.path }) }, timeoutMs: 60_000 });
    runs[name] = { code: r.code, stdout: r.stdout + r.stderr, calls: ghCalls(w).slice(before) };
  }

  beforeAll(async () => {
    w = await world("work");
    fakeGh(w);
    mkdirSync(join(w.root, ".agents", "scripts"), { recursive: true });
    writeFileSync(join(w.root, ".agents", "scripts", "ci-failures.sh"), readFileSync(repoFile(".agents", "scripts", "ci-failures.sh"), "utf8"));
    await sh(w.root, "git", "checkout", "-q", "-b", BRANCH);
    await sh(w.root, "git", "push", "-q", "origin", BRANCH);

    const ship = repoFile("packages", "pack-sdlc", "assets", "workflows", "shared", "ship.yaml");
    const ci = repoFile(".agents", "workflows", "shared", "ci.yaml");
    const empty = join(w.dir, "empty-bin");
    mkdirSync(empty);
    await run("ship green", ship, { checks: "success" });
    await run("ship red", ship, { checks: "failure" });
    await run("ship none", ship, { checks: "none" });
    await run("ship conflicting", ship, { checks: "success", mergeable: "CONFLICTING" });
    await run("ship unknown", ship, { checks: "success", mergeable: ["UNKNOWN", "MERGEABLE"] });
    await run("ship came to conflict", ship, { checks: "none", mergeable: ["MERGEABLE", "CONFLICTING"] });
    await run("ship no gh", ship, { checks: "failure" }, { path: empty });
    await run("ship no GitHub remote", ship, { checks: "failure" }, { fail: { "repo view": { code: 1, stderr: "none of the git remotes configured for this repository point to a known GitHub host" } } });
    await run("ci green", ci, { run: "success" });
    await run("ci red", ci, { run: "failure" });
    await run("ci no run", ci, { run: null });
    await run("ci conflicting", ci, { run: "success", mergeable: "CONFLICTING" });
    await run("ci unknown", ci, { run: "success", mergeable: ["UNKNOWN", "MERGEABLE"] });
    await run("ci came to conflict", ci, { run: null, mergeable: ["MERGEABLE", "CONFLICTING"] });
  }, SLOW);

  const mergeableAsks = (r: ScriptRun | undefined) => (r?.calls ?? []).filter((c) => c.join(" ").includes("--json mergeable")).length;

  test("the pack's ship ci: green passes, red fails naming the failed check's URL, no checks passes", () => {
    expect(runs["ship green"]?.code).toBe(0);
    expect(runs["ship red"]?.code).toBe(1);
    expect(runs["ship red"]?.stdout).toContain(`- test (id 7): ${WEB}/actions/runs/1/job/7`);
    expect(runs["ship none"]?.code).toBe(0);
    expect(runs["ship none"]?.stdout).toContain("nothing to wait for");
  });

  test("the pack's ship ci: a conflicting PR is stale (exit 3), UNKNOWN is asked again, and a PR that came to conflict while waiting is stale", () => {
    expect(runs["ship conflicting"]?.code).toBe(3);
    expect(runs["ship unknown"]?.code).toBe(0);
    expect(mergeableAsks(runs["ship unknown"])).toBe(2);
    expect(runs["ship came to conflict"]?.code).toBe(3);
  });

  test("the pack's ship ci passes with no gh and with no GitHub remote", () => {
    expect(runs["ship no gh"]?.code).toBe(0);
    expect(runs["ship no gh"]?.stdout).toContain("gh not found");
    expect(runs["ship no GitHub remote"]?.code).toBe(0);
    expect(runs["ship no GitHub remote"]?.stdout).toContain("no GitHub remote");
  });

  test("this repo's ci: green passes, red fails naming the failed jobs and never the log, no run in 5 minutes fails", () => {
    expect(runs["ci green"]?.code).toBe(0);
    expect(runs["ci red"]?.code).toBe(1);
    expect(runs["ci red"]?.stdout).toContain(`CI run 9002 failed: ${WEB}/actions/runs/9002`);
    expect(runs["ci red"]?.stdout).toContain("- job 7: test");
    expect((runs["ci red"]?.calls ?? []).filter((c) => c.includes("--log") || c.includes("--log-failed"))).toEqual([]);
    expect(runs["ci no run"]?.code).toBe(1);
    expect(runs["ci no run"]?.stdout).toContain("after 5m");
  });

  test("this repo's ci: a conflicting PR is stale (exit 3), UNKNOWN is asked again, and a PR that came to conflict while waiting is stale", () => {
    expect(runs["ci conflicting"]?.code).toBe(3);
    expect(runs["ci unknown"]?.code).toBe(0);
    expect(mergeableAsks(runs["ci unknown"])).toBe(2);
    expect(runs["ci came to conflict"]?.code).toBe(3);
  });
});
