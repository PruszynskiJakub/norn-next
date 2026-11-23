/**
 * The lab's dashboard through its handler: `GET /api/state` over what was read of a lab (a fake one,
 * the workflow loaded from the bundled pack), and each button through `POST /api/act/<name>` running
 * its command over a scripted exec, so nothing starts and every call it makes is seen.
 */
import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost, scriptedExec } from "@norn/conformance";
import type { Pack } from "@norn/plugin-api";
import { collectStepKinds, findProvided, loadPackWorkflows } from "@norn/runtime";
import { RULE_CAPTIONS } from "../../src/captions.ts";
import { configPaths } from "../../src/config/paths.ts";
import { BUNDLED_PLUGINS } from "../../src/index.ts";
import { runLabCommand } from "../../src/lab/act.ts";
import { buttonCommand, dashboardState, LAB_PERSON_ACTIONS, LAB_RESET_COMMAND, type LabActAnswer, type LabActionName, labHandler, type LabSources, type LabState } from "../../src/lab/dashboard.ts";
import { EXECUTOR_BLOCK, type LabRun, placeInBeat } from "../../src/lab/lab.ts";
import { LAB_PAGE } from "../../src/lab/page.ts";
import { labPaths } from "../../src/lab/paths.ts";
import { labMerge, labScript } from "../../src/lab/script.ts";
import { STANDING } from "../../src/tick-report.ts";
import type { StoryView, UnitView } from "../../src/views.ts";
import { nodeId } from "../../src/workflows-page.ts";

const script = labScript();
const KEY = "lt-1";
const paths = labPaths("/tmp/t");
const SELF = ["norn-dev"];

function loaded() {
  const kinds = collectStepKinds(BUNDLED_PLUGINS);
  const pack = findProvided<Pack>(BUNDLED_PLUGINS, "packs", "sdlc");
  if (!kinds.ok || !pack.ok) throw new Error("the bundled pack does not load");
  const loads = loadPackWorkflows(pack.value, kinds.value);
  if (!loads.ok) throw new Error(loads.failure.message);
  const w = loads.value[script.workflow];
  if (w === undefined || !w.ok) throw new Error(`${script.workflow} does not load`);
  return w.workflow;
}
const workflow = loaded();
const rules = Object.keys(RULE_CAPTIONS);
const moving = rules.find((r) => r.startsWith("check.")) as string;

const unitView = (over: Partial<UnitView> = {}): UnitView => ({
  id: KEY,
  step: "implement",
  kind: "agent",
  attempt: 2,
  workflow: script.workflow,
  run: null,
  waiting: null,
  pending_receipts: 0,
  counters: {},
  ...over,
});
const storyView = (units: UnitView[]): StoryView => ({ key: KEY, title: "Greet the world", url: null, open: true, claim: { holder: "me@box", expires_at: "2026-01-01T01:00:00.000Z" }, change: null, units });

function sources(over: Partial<LabSources> = {}): LabSources {
  const unit = unitView();
  return {
    view: placeInBeat(paths, false, KEY, unit),
    workflow: { name: script.workflow, loaded: workflow },
    story: storyView([unit]),
    record: null,
    traces: [],
    docs: [],
    session: null,
    ...over,
  };
}

const merge = (key: string) => labMerge(script, key);
const noAct = async (): Promise<LabActAnswer> => {
  throw new Error("no button is pressed in this test");
};

async function stateOf(s: LabSources): Promise<LabState> {
  const handle = labHandler({ page: LAB_PAGE, state: async () => dashboardState(s, merge), act: noAct });
  const res = await handle(new Request("http://127.0.0.1/api/state"));
  expect(res.status).toBe(200);
  return (await res.json()) as LabState;
}

describe("the dashboard's state", () => {
  test("AC3: carries the lab's workflow graph and names the live step, lit on the graph", async () => {
    const s = await stateOf(sources());
    expect(s.graph.workflow).toBe("quick");
    expect(s.graph.live).toBe("implement");
    expect(s.graph.steps).toEqual(Object.keys(workflow.graph.steps));
    expect(s.graph.mermaid).toContain("flowchart TD");
    expect(s.graph.mermaid).toContain(`class ${nodeId("implement")} live`);
    expect(s.lab).toMatchObject({ story: KEY, beat: { n: 2, of: 8 } });

    const ended = await stateOf(sources({ story: storyView([unitView({ step: "merge", ended: "done" })]) }));
    expect(ended.graph.live).toBeNull();
    expect(ended.graph.mermaid).not.toContain(" live\n");
  });

  test("AC4: each decision a tick made carries its plain-word caption, in tick order, and ticks of only waiting are left out", async () => {
    const standing = [...STANDING][0] as string;
    const traces = [
      { tick_id: "01B", at: "2026-01-01T00:00:02.000Z", outcomes: [{ decision: { rule: moving, kind: "apply_check", unit: KEY }, ok: true }] },
      { tick_id: "01A", at: "2026-01-01T00:00:01.000Z", outcomes: [{ decision: { rule: "claim.take", kind: "claim", unit: null }, ok: true }, { decision: { rule: "claim.renew", kind: standing, unit: null }, ok: true }] },
      { tick_id: "01C", at: "2026-01-01T00:00:03.000Z", outcomes: [{ decision: { rule: "unit.enter", kind: "enter", unit: KEY }, ok: false, error: "lost" }] },
    ];
    const s = await stateOf(sources({ traces }));
    expect(s.decisions.map((d) => [d.tick, d.rule, d.ok])).toEqual([
      ["01A", "claim.take", true],
      ["01B", moving, true],
      ["01C", "unit.enter", false],
    ]);
    expect(s.decisions[0]).toMatchObject({ unit: "-", kind: "claim", caption: RULE_CAPTIONS["claim.take"] });
    expect(s.decisions[1]?.caption).toBe(RULE_CAPTIONS[moving] as string);
  });

  test("AC5: lists a step's receipts in the order written, each naming the effect it is written before, and the state commit last", async () => {
    const receipts = [
      { seq: 3, at: "2026-01-01T00:00:03.000Z", data: { kind: "run.reported", step: "implement", run_id: "r1", verb: "done", outcome: "done" } },
      { seq: 1, at: "2026-01-01T00:00:01.000Z", data: { kind: "run.started", step: "implement", run_id: "r1", run_kind: "agent", executor: "lab" } },
      { seq: 2, at: "2026-01-01T00:00:02.000Z", data: { kind: "run.ended", step: "implement", run_id: "r1", reason: "exit" } },
    ];
    const s = await stateOf(sources({ record: { receipts, state: { version: 4, data: { step: "check", applied_through: 3 } } } }));
    expect(s.receipts.unit).toBe(KEY);
    expect(s.receipts.entries.map((e) => [e.seq, e.kind])).toEqual([
      [1, "run.started"],
      [2, "run.ended"],
      [3, "run.reported"],
      [null, "state.committed"],
    ]);
    expect(s.receipts.entries[0]?.before).toBe("the run is launched");
    expect(s.receipts.entries[2]?.what).toContain("outcome done");
    expect(s.receipts.entries.at(-1)?.what).toBe("version 4, step check, receipts 1–3 applied");
  });

  test("AC6: needs-you lists a question and a gate waiting, as status does, with the command that answers each", async () => {
    const asked = unitView({ waiting: { for: "answer", text: "Keep the comma?", next: `norn story answer ${KEY} "<answer>"` } });
    const gate = unitView({ id: `${KEY}/01`, step: "ready", kind: "gate", waiting: { for: "gate", text: "ready waits for a person" } });
    const s = await stateOf(sources({ story: storyView([asked, gate, unitView({ id: `${KEY}/02` })]) }));
    expect(s.needs_you).toEqual([
      { unit: KEY, for: "answer", text: "Keep the comma?", next: `norn story answer ${KEY} "<answer>"` },
      { unit: `${KEY}/01`, for: "gate", text: "ready waits for a person", next: null },
    ]);
    expect((await stateOf(sources())).needs_you).toEqual([]);
  });

  test("AC7: the story's spec, handoffs and pull request body, and the agent's session, are there to show", async () => {
    const docs = [
      { path: "spec.md", text: "# Greet the world" },
      { path: "handoffs/lt-1.md", text: "# Handoff" },
      { path: "pr.md", text: "## Summary" },
    ];
    const session = { run: "r1", executor: "lab", log: "read my brief\nreported done\n" };
    const s = await stateOf(sources({ docs, session }));
    expect(s.docs).toEqual(docs);
    expect(s.session).toEqual(session);
  });

  test("each button shows the command it runs before it is pressed, what the person types shown as a placeholder", async () => {
    const s = await stateOf(sources());
    expect(Object.fromEntries(s.actions.filter((a) => a.group === "person").map((a) => [a.name, a.command]))).toEqual({
      approve: `norn story approve ${KEY}`,
      reject: `norn story reject ${KEY} --reason '<reason>'`,
      answer: `norn story answer ${KEY} '<answer>'`,
      rerun: `norn run rerun ${KEY}`,
      merge: labMerge(script, KEY),
      round: `norn story round ${KEY} --workflow ${script.workflow}`,
      reset: LAB_RESET_COMMAND,
    });
    expect(s.actions.filter((a) => a.input !== null).map((a) => [a.name, a.input])).toEqual([
      ["reject", "reason"],
      ["answer", "answer"],
    ]);
  });
});

describe("the dashboard's routes", () => {
  const pressed: { name: LabActionName; typed: string | undefined }[] = [];
  const handle = labHandler({
    page: LAB_PAGE,
    state: async () => dashboardState(sources(), merge),
    act: async (name, typed) => {
      pressed.push({ name, typed });
      return { action: name, command: `ran ${name}`, exit: 0, output: "", way_out: null };
    },
  });
  const post = (path: string, body?: unknown) => handle(new Request(`http://127.0.0.1${path}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));

  test("GET / is the page, which polls the state and posts the buttons", async () => {
    const res = await handle(new Request("http://127.0.0.1/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const page = await res.text();
    expect(page).toContain('fetch("/api/state")');
    expect(page).toContain('"/api/act/"');
  });

  test("a button with what it needs reaches its command; one missing its input, an unknown one or a GET is refused before anything runs", async () => {
    pressed.length = 0;
    expect(await (await post("/api/act/reject", { text: "Name it in the README." })).json()).toEqual({ action: "reject", command: "ran reject", exit: 0, output: "", way_out: null });
    const missing = await post("/api/act/answer", { text: "  " });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "input_missing" });
    const unknown = await post("/api/act/..%2F..%2Fetc");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "unknown_action" });
    expect((await handle(new Request("http://127.0.0.1/api/act/approve"))).status).toBe(405);
    expect((await handle(new Request("http://127.0.0.1/etc/passwd"))).status).toBe(404);
    expect(pressed).toEqual([{ name: "reject", typed: "Name it in the README." }]);
  });
});

describe("the dashboard's buttons over a lab", () => {
  const STATUS = JSON.stringify({ stories: [], intake: [{ key: KEY }] });

  function lab() {
    const files = memoryFiles({ [configPaths(paths.home, paths.repo).local]: `format: 1\n${EXECUTOR_BLOCK}` });
    const exec = scriptedExec((argv) => (argv.includes("status") ? { stdout: STATUS } : { stdout: "ok\n" }));
    const run: LabRun = { host: memoryHost({ files, exec, repo: { root: paths.repo, dataDir: paths.home } }), paths, self: SELF };
    const handle = labHandler({
      page: LAB_PAGE,
      state: async () => dashboardState(sources(), merge),
      act: async (name, typed) => {
        const command = buttonCommand(name, { key: KEY, workflow: script.workflow, merge: merge(KEY) }, typed);
        if (command === null) throw new Error(`${name} has no command`);
        return runLabCommand(run, name, command);
      },
    });
    const press = async (name: LabActionName, text?: string): Promise<LabActAnswer> => {
      const res = await handle(new Request(`http://127.0.0.1/api/act/${name}`, { method: "POST", body: JSON.stringify({ text }) }));
      expect(res.status).toBe(200);
      return (await res.json()) as LabActAnswer;
    };
    return { files, exec, press };
  }

  test("AC8: each person button runs its real command in the lab and answers with the command it ran", async () => {
    const { exec, press } = lab();
    const typed: Partial<Record<LabActionName, string>> = { reject: "Name the greeting in the README too.", answer: "Keep the comma." };
    const answers: LabActAnswer[] = [];
    for (const name of LAB_PERSON_ACTIONS.filter((n) => n !== "reset")) answers.push(await press(name, typed[name]));
    expect(answers.map((a) => [a.action, a.command, a.exit])).toEqual([
      ["approve", `norn story approve ${KEY}`, 0],
      ["reject", `norn story reject ${KEY} --reason 'Name the greeting in the README too.'`, 0],
      ["answer", `norn story answer ${KEY} 'Keep the comma.'`, 0],
      ["rerun", `norn run rerun ${KEY}`, 0],
      ["merge", labMerge(script, KEY), 0],
      ["round", `norn story round ${KEY} --workflow ${script.workflow}`, 0],
    ]);
    expect(exec.calls.map((c) => c.argv)).toEqual([
      [...SELF, "story", "approve", KEY],
      [...SELF, "story", "reject", KEY, "--reason", "Name the greeting in the README too."],
      [...SELF, "story", "answer", KEY, "Keep the comma."],
      [...SELF, "run", "rerun", KEY],
      ["sh", "-c", labMerge(script, KEY)],
      [...SELF, "story", "round", KEY, "--workflow", script.workflow],
    ]);
    expect(answers[0]?.output).toBe("ok");
  });

  test("AC9: Reset removes the lab and builds it again from beat 1, as norn lab --clean does", async () => {
    const { exec, press } = lab();
    const answer = await press("reset");
    expect(answer).toMatchObject({ action: "reset", command: LAB_RESET_COMMAND, exit: 0 });
    expect(answer.output).toContain("Built a new lab");
    expect(answer.output).toContain("Beat 1 of 8");
    expect(exec.calls[0]?.argv).toEqual(["rm", "-rf", paths.root]);
    expect(exec.calls.some((c) => c.argv.join(" ") === [...SELF, "story", "create", script.story.title, "--body", script.story.body, "--workflow", script.workflow, "--json"].join(" "))).toBe(true);
  });

  test("AC10: every button runs in the lab's repo with the lab's own norn home, and writes only under the lab's folder", async () => {
    const { exec, files, press } = lab();
    for (const name of LAB_PERSON_ACTIONS) await press(name, "typed");
    for (const c of exec.calls) {
      expect(c.opts.env?.NORN_HOME_DIR).toBe(paths.home);
      if (c.argv[0] === "rm") expect(c.argv).toEqual(["rm", "-rf", paths.root]);
      else expect(c.opts.cwd === paths.repo || c.opts.cwd === paths.root).toBe(true);
    }
    expect(Object.keys(files.snapshot()).filter((p) => !p.startsWith(`${paths.root}/`))).toEqual([]);
  });
});
