/**
 * gh-110 B1, B2, B4: the repo config lives at `.agents/norn.config.yaml` and the repo workflows in
 * `.agents/workflows/` — written there by `init`, read there by every command, named there by every
 * message (D11) — and a unit keeps the workflow it pinned when the file changes on the base (S7).
 * The paths are spelled out here on purpose: this is what a person sees.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHarness, FakeInteraction, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const CONFIG_FILE = ".agents/norn.config.yaml";
const WORKFLOWS = ".agents/workflows";

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: story
default_mode: manual
notifiers: []
`;

const gateFirst = (name: string, prompt: string) => `name: ${name}
start: approve
steps:
  approve:
    type: gate
    prompt: "${prompt}"
    outcomes: { approve: $done, reject: $stuck }
`;

let h: Harness;
let init: Awaited<ReturnType<Harness["norn"]>>;
beforeAll(async () => {
  h = await createHarness();
  init = await h.norn("init");
});
afterAll(() => h.cleanup());

const pinned = (n: number, slug: string) => h.read(join(`${h.root}-worktrees/gh-${n}-${slug}`, `.agents/specs/gh-${n}-${slug}/runs/_story/workflow.yaml`));
async function ticks(n = 8) {
  for (let i = 0; i < n; i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
}
function commitOnBase(message: string) {
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", message]);
  h.git(["push", "-q", "origin", "main"]);
}

describe("norn init writes the new layout (B1, B2)", () => {
  test("config file and workflows in .agents/workflows/; no folder of norn's own under .agents/", () => {
    expect(init.exit).toBe(0);
    expect(existsSync(join(h.root, CONFIG_FILE))).toBe(true);
    for (const f of ["story.yaml", "slice.yaml", "bug.yaml"]) expect(existsSync(join(h.root, WORKFLOWS, f))).toBe(true);
    expect(readdirSync(join(h.root, ".agents")).sort()).toEqual(["norn.config.yaml", "skills", "workflows"]);
    expect(init.stdout).toContain(`config          ${CONFIG_FILE} created`);
    expect(init.stdout).toContain("the `test` steps in .agents/workflows/ run");
  });

  test("norn config shows repo settings as coming from the repo config file", async () => {
    h.write(join(h.root, CONFIG_FILE), CONFIG);
    const r = await h.norn("config", "list", "--json");
    expect(r.value).toMatchObject({ files: { repo: { path: join(h.root, CONFIG_FILE), exists: true } } });
    expect((r.value as { entries: Array<{ key: string; source: string }> }).entries.find((e) => e.key === "default_mode")).toMatchObject({ source: "repo" });
    expect((await h.norn("config", "list")).stdout).toContain(CONFIG_FILE);
  });
});

describe("messages name the new paths (D11)", () => {
  test("config set asks between the user file and the repo config file; --repo help names it", async () => {
    const term = new FakeInteraction();
    term.answers = [null];
    await runChecked(["config", "set", "default_mode", "auto"], { ...h.deps, interaction: term });
    expect(term.picks[0]?.question).toBe(`Write to user (~/.norn/config.yaml) or repo (${CONFIG_FILE})?`);
    expect(term.picks[0]?.choices.find((c) => c.value === "repo")?.label).toContain(CONFIG_FILE);
    expect((await h.norn("config", "set", "--help")).stdout).toContain(`edit ${CONFIG_FILE}`);
  });

  test("story create refuses an unknown workflow naming .agents/workflows/", async () => {
    const created = await h.norn("story", "create", "--title", "Nope", "--workflow", "nope", "--json");
    expect(created.value).toMatchObject({ code: "unknown_workflow", error: expect.stringContaining(`no workflow 'nope' in ${WORKFLOWS}/`) });
  });

  test("an adapter that cannot be loaded names the repo config file", async () => {
    h.write(join(h.root, CONFIG_FILE), CONFIG.replace("agents:\n", "agents:\n  other: { adapter: no-such-agent-pkg }\n"));
    const r = await h.norn("tick");
    expect(r.value).toMatchObject({ code: "unknown_adapter", do_instead: expect.stringContaining(CONFIG_FILE) });
    h.write(join(h.root, CONFIG_FILE), CONFIG);
  });
});

describe("workflows in .agents/workflows/ run and stay pinned (B2, B4, S7)", () => {
  beforeAll(() => {
    h.write(join(h.root, WORKFLOWS, "story.yaml"), gateFirst("story", "v1"));
    h.write(join(h.root, WORKFLOWS, "quick.yaml"), gateFirst("quick", "quick"));
    commitOnBase("norn init");
    h.remote.issues = [issue(7, "Seven"), issue(8, "Eight", ["norn", "norn:wf:quick"])];
  });

  test("a story labelled norn:wf:quick runs .agents/workflows/quick.yaml", async () => {
    await ticks();
    expect(pinned(8, "eight")).toBe(gateFirst("quick", "quick"));
    expect(pinned(7, "seven")).toBe(gateFirst("story", "v1"));
  });

  test("story edit --workflow refuses an unknown one naming .agents/workflows/", async () => {
    const r = await h.norn("story", "edit", "gh-7", "--workflow", "nope", "--json");
    expect(r.value).toMatchObject({ code: "unknown_workflow", error: `no workflow 'nope' in ${WORKFLOWS}/` });
  });

  test("story.yaml changed on the base: gh-7 keeps its pinned copy, a story started afterwards pins the new one", async () => {
    h.write(join(h.root, WORKFLOWS, "story.yaml"), gateFirst("story", "v2"));
    commitOnBase("story workflow v2");
    h.remote.issues = [...h.remote.issues, issue(9, "Nine")];
    await h.tick("--sync");
    await ticks();
    expect(pinned(7, "seven")).toBe(gateFirst("story", "v1"));
    expect(pinned(9, "nine")).toBe(gateFirst("story", "v2"));
  });
});
