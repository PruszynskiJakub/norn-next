/**
 * The dashboard's break-it switches through its handler, over a fake lab: each switch reads the lab
 * through a scripted exec and memory files, runs its one shell line through the host's exec, and
 * answers with that line and the way out. Nothing starts; every call it makes is seen.
 */
import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost, type ScriptedExec, scriptedExec } from "@norn/conformance";
import { type ExecOptions, type HostContext, type Pack, parseJson } from "@norn/plugin-api";
import { encodeHandle, keyRecordPath } from "@norn/runner-headless";
import { collectStepKinds, findProvided, loadPackWorkflows } from "@norn/runtime";
import { ClaimFile, layout } from "@norn/store-local";
import { machineDir, machineId } from "../../src/home.ts";
import { BUNDLED_PLUGINS } from "../../src/index.ts";
import { runLabCommand } from "../../src/lab/act.ts";
import { BREAK_CHECK_MESSAGE, BREAK_NAMES, BREAKS, type BreakName, MOVE_BASE_MESSAGE, OTHER_HOLDER, stateBackup } from "../../src/lab/break-it.ts";
import { buttonCommand, dashboardState, type LabActAnswer, type LabActionName, labHandler, type LabState } from "../../src/lab/dashboard.ts";
import { type LabRun, placeInBeat } from "../../src/lab/lab.ts";
import { LAB_PAGE } from "../../src/lab/page.ts";
import { labPaths } from "../../src/lab/paths.ts";
import { labMerge, labScript } from "../../src/lab/script.ts";

const script = labScript();
const KEY = "lt-1";
const paths = labPaths("/tmp/t");
const SELF = ["norn-dev"];
const NOW = "2026-03-01T12:00:00.000Z";
const RUN = "01RUNAAAAAAAAAAAAAAAAAAAAA";
const WORKTREE = `${paths.home}/repos/repo-x/worktrees/${KEY}`;
const DATA = machineDir(paths.home, machineId(`${paths.repo}/.git`));
const store = layout(DATA);
const DEAD_PID = 666;

function quick() {
  const kinds = collectStepKinds(BUNDLED_PLUGINS);
  const pack = findProvided<Pack>(BUNDLED_PLUGINS, "packs", "sdlc");
  if (!kinds.ok || !pack.ok) throw new Error("the bundled pack does not load");
  const loads = loadPackWorkflows(pack.value, kinds.value);
  if (!loads.ok) throw new Error(loads.failure.message);
  const w = loads.value[script.workflow];
  if (w === undefined || !w.ok) throw new Error(`${script.workflow} does not load`);
  return w.workflow;
}

interface FakeLab {
  /** the unit's run in `norn status --json`, null for none */
  run?: { id: string; kind: string } | null;
  /** the headless runner's records, by key */
  records?: Record<string, string>;
  claim?: unknown;
  state?: string | null;
}

const recordOf = (pid: number) => `${JSON.stringify({ key: "k", handle: encodeHandle({ pid, started: `start-${pid}` }) })}\n`;
const ctxOf = (host: HostContext) => ({ ...host, repo: { root: paths.repo, dataDir: DATA } });

function lab(f: FakeLab = {}) {
  const run = f.run === undefined ? { id: RUN, kind: "agent" } : f.run;
  const status = JSON.stringify({ stories: [{ key: KEY, units: [{ id: KEY, kind: run?.kind ?? "agent", run: run === null ? null : { id: run.id } }] }], intake: [] });
  const worktrees = [`worktree ${paths.repo}`, "HEAD aaa", "branch refs/heads/main", "", `worktree ${WORKTREE}`, "HEAD bbb", `branch refs/heads/norn/${KEY}`, ""].join("\n");
  const claim = f.claim === undefined ? { version: 3, claim: { story: KEY, holder: "me@box", acquired_at: "2026-03-01T11:30:00.000Z", expires_at: "2026-03-01T12:30:00.000Z", version: 3 } } : f.claim;
  const seed: Record<string, string> = {};
  const host0 = memoryHost({ repo: { root: paths.repo, dataDir: DATA } });
  for (const [key, text] of Object.entries(f.records ?? { [RUN]: recordOf(4242) })) seed[keyRecordPath(ctxOf(host0), key)] = text;
  if (claim !== null) seed[store.claim(KEY)] = `${JSON.stringify(claim)}\n`;
  if (f.state !== null) seed[store.state(KEY)] = f.state ?? `${JSON.stringify({ version: 7, data: { step: "implement" } })}\n`;
  const files = memoryFiles(seed);
  const exec: ScriptedExec = scriptedExec((argv: string[], _opts: ExecOptions) => {
    if (argv.join(" ") === "git rev-parse --path-format=absolute --git-common-dir --show-toplevel") return { stdout: `${paths.repo}/.git\n${paths.repo}\n` };
    if (argv.join(" ") === "git worktree list --porcelain") return { stdout: worktrees };
    if (argv.includes("status")) return { stdout: status };
    if (argv[0] === "sh") return { stdout: "" };
    return undefined;
  });
  const host: HostContext = { ...memoryHost({ files, exec, now: () => NOW, repo: { root: paths.repo, dataDir: paths.home } }), alive: async (pid: number) => pid !== DEAD_PID };
  const runner: LabRun = { host, paths, self: SELF };
  const handle = labHandler({
    page: LAB_PAGE,
    state: async () => {
      throw new Error("no state is read in this test");
    },
    act: async (name, typed) => {
      const command = buttonCommand(name, { key: KEY, workflow: script.workflow, merge: labMerge(script, KEY) }, typed);
      if (command === null) throw new Error(`${name} has no command`);
      return runLabCommand(runner, name, command);
    },
  });
  const post = (name: LabActionName) => handle(new Request(`http://127.0.0.1/api/act/${name}`, { method: "POST", headers: { "content-type": "application/json" } }));
  const press = async (name: LabActionName): Promise<LabActAnswer> => {
    const res = await post(name);
    if (res.status !== 200) throw new Error(`${name} answered ${res.status}: ${await res.text()}`);
    return (await res.json()) as LabActAnswer;
  };
  /** the one shell line a switch ran */
  const ran = () => exec.calls.filter((c) => c.argv[0] === "sh");
  return { files, exec, press, post, ran };
}

describe("the break-it switches", () => {
  test("AC1: kill the agent stops every process group of the running agent's run, its resumed session's too, and only the live ones", async () => {
    const { press, ran } = lab({ records: { [RUN]: recordOf(4242), [`${RUN}.ask_1`]: recordOf(4343), [`${RUN}.ask_0`]: recordOf(DEAD_PID), "01OTHERRUNAAAAAAAAAAAAAAAA": recordOf(5555) } });
    const answer = await press("kill");
    expect(answer.action).toBe("kill");
    expect(answer.command.split("; ").sort()).toEqual(["kill -s KILL -- -4242", "kill -s KILL -- -4343"]);
    expect(answer.exit).toBe(0);
    expect(ran().map((c) => c.argv)).toEqual([["sh", "-c", answer.command]]);
  });

  test("AC1: with no agent running, kill is refused and runs nothing", async () => {
    for (const f of [{ run: null }, { run: { id: RUN, kind: "check" } }, { records: { [RUN]: recordOf(DEAD_PID) } }] satisfies FakeLab[]) {
      const { post, ran } = lab(f);
      const res = await post("kill");
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "lab_not_ready" });
      expect(ran()).toEqual([]);
    }
  });

  test("AC2: make the check fail commits a test that always fails on the story's branch, in its worktree", async () => {
    const { press } = lab();
    const answer = await press("fail-check");
    expect(answer.command.startsWith(`cd ${WORKTREE} && printf`)).toBe(true);
    expect(answer.command).toContain("> test.sh && git add test.sh && git -c user.name='norn lab'");
    expect(answer.command).toContain(`commit -q -m '${BREAK_CHECK_MESSAGE}'`);
    expect(answer.command).toContain("exit 1");
  });

  test("AC3: move the base commits a greet.sh and test.sh the story also changes on the lab's base, and pushes it to its remote", async () => {
    const { press } = lab();
    const answer = await press("move-base");
    expect(answer.command.startsWith(`cd ${paths.repo} && git checkout -q main && printf`)).toBe(true);
    expect(answer.command).toContain("> greet.sh");
    expect(answer.command).toContain("> test.sh");
    expect(answer.command).toContain(`commit -q -m '${MOVE_BASE_MESSAGE}' && git push -q origin main`);
  });

  test("AC4: edit a run-state file keeps a copy of the unit's state in the lab's folder, then writes invalid JSON over the store's state file", async () => {
    const { press } = lab();
    const answer = await press("corrupt");
    const backup = stateBackup(paths, KEY);
    expect(backup.startsWith(`${paths.root}/`)).toBe(true);
    expect(answer.command).toBe(`mkdir -p ${paths.root}/break-it && cp ${store.state(KEY)} ${backup} && printf '%s\\n' '{"version": "edited by hand' > ${store.state(KEY)}`);
  });

  test("AC4: with no state yet, the corrupt switch is refused", async () => {
    const res = await lab({ state: null }).post("corrupt");
    expect(res.status).toBe(409);
  });

  test("AC5: expire the claim rewrites the story's claim as another machine's, expired before now, at the same version", async () => {
    const { press } = lab();
    const answer = await press("expire-claim");
    const m = /^printf '%s\\n' '(.*)' > (\S+)$/.exec(answer.command);
    expect(m?.[2]).toBe(store.claim(KEY));
    const parsed = parseJson(ClaimFile, m?.[1] ?? "", "the written claim");
    if (!parsed.ok) throw new Error(parsed.failure.message);
    const written = parsed.value;
    expect(written.version).toBe(3);
    expect(written.claim).toMatchObject({ story: KEY, holder: OTHER_HOLDER, version: 3 });
    expect(Date.parse(written.claim?.expires_at ?? "")).toBeLessThan(Date.parse(NOW));
    expect(OTHER_HOLDER).not.toBe("me@box");
  });

  test("AC5: with no claim held, the expire switch is refused", async () => {
    for (const claim of [null, { version: 4, claim: null }]) {
      const res = await lab({ claim }).post("expire-claim");
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "lab_not_ready" });
    }
  });

  test("AC6: each switch answers with the command it ran and the real way out", async () => {
    const wayOut: Record<BreakName, string[]> = {
      kill: ["agent.died.retry", `norn run rerun ${KEY}`],
      "fail-check": [`git -C ${WORKTREE} revert --no-edit`, `--grep='${BREAK_CHECK_MESSAGE}'`, `norn run rerun ${KEY}`],
      "move-base": [`cd ${WORKTREE} && git merge origin/main`, `norn run rerun ${KEY} --step update`],
      corrupt: ["`corrupt`", `cp ${stateBackup(paths, KEY)} ${store.state(KEY)}`],
      "expire-claim": [OTHER_HOLDER, `norn story take ${KEY} --force`],
    };
    for (const name of BREAK_NAMES) {
      const { press, ran } = lab();
      const answer = await press(name);
      expect(ran().map((c) => c.argv)).toEqual([["sh", "-c", answer.command]]);
      for (const said of wayOut[name]) expect(answer.way_out).toContain(said);
    }
    // the step the base update's way out reruns is one of the lab's workflow
    expect(Object.keys(quick().graph.steps)).toContain("update");
  });

  test("AC7: every switch runs in the lab, with the lab's own norn home, and names only paths under the lab's folder", async () => {
    for (const name of BREAK_NAMES) {
      const { exec, files, press } = lab();
      const before = files.snapshot();
      const answer = await press(name);
      for (const c of exec.calls) {
        expect(c.opts.cwd).toBe(paths.repo);
        if (c.argv[0] !== "git") expect(c.opts.env?.NORN_HOME_DIR).toBe(paths.home);
      }
      // every place it changes into, writes or copies, named whole: a bare name is in the folder it changed into
      const places = [...answer.command.matchAll(/(?:cd |> |mkdir -p |cp )(\S+)(?: (\/\S+))?/g)].flatMap((m) => [m[1], m[2]].filter((p): p is string => p !== undefined));
      if (name !== "kill") expect(places.length).toBeGreaterThan(0);
      for (const p of places.filter((p) => p.startsWith("/"))) expect(p.startsWith(`${paths.root}/`)).toBe(true);
      expect(files.snapshot()).toEqual(before);
    }
  });

  test("the person's buttons answer with no way out", async () => {
    const { press } = lab();
    expect((await press("approve")).way_out).toBeNull();
  });
});

describe("the break-it switches on the page", () => {
  test("each switch is a button of its own group, showing what it runs before it is pressed", () => {
    const unit = { id: KEY, step: "implement", kind: "agent", attempt: 1, workflow: script.workflow, run: null, waiting: null, pending_receipts: 0, counters: {} };
    const state: LabState = dashboardState(
      {
        view: placeInBeat(paths, false, KEY, unit),
        workflow: { name: script.workflow, loaded: quick() },
        story: { key: KEY, title: "t", url: null, open: true, claim: null, change: null, units: [unit] },
        record: null,
        traces: [],
        docs: [],
        session: null,
      },
      (key) => labMerge(script, key),
    );
    const breaks = state.actions.filter((a) => a.group === "break");
    expect(breaks.map((a) => [a.name, a.label, a.command])).toEqual(BREAK_NAMES.map((n) => [n, BREAKS[n].label, BREAKS[n].preview]));
    expect(state.actions.filter((a) => a.group === "person").map((a) => a.name)).toEqual(["approve", "reject", "answer", "rerun", "merge", "round", "reset"]);
    expect(LAB_PAGE).toContain("Break it");
    expect(LAB_PAGE).toContain("way_out");
  });
});
