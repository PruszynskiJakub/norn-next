/**
 * The test harness's agent: started by the headless runner in the unit's worktree, it acts as a
 * coding agent does through its hooks and reports through the `norn` on its PATH, as subprocesses.
 * Each thing it saw is appended as one JSON line to `$TEST_AGENT_NOTES/<run id>.jsonl` for the test.
 *
 * Every launch notes `norn brief` (markdown, and `--json` as `brief.json`), then follows its plan.
 * The plan is TEST_AGENT_PLAN, unless the JSON file TEST_AGENT_PLANS maps the step (`"<step>"`) or
 * one visit of it (`"<step>#<attempt>"`) to another, so one story can mix plans per step. A key may
 * name the unit first (`"<unit>:<step>"`, `"<unit>:<step>#<attempt>"`), so two slices on one slice
 * workflow can follow different plans; such a key wins over the bare step.
 *
 * Plans:
 * - work: a write in the worktree and one into norn's machine dir, a commit, a stop before
 *   reporting (blocked), `norn done` with an outcome the step lacks (refused), `norn done done`,
 *   then a stop and an end. The tick applying the report may stop this process at once, so the stop
 *   after the report runs in a process of its own group (TEST_AGENT_ONLY), which that stop never
 *   reaches: its note is always written.
 * - ask: `norn ask`, then a stop and an exit, as `claude -p` does once its stop hook allows; the
 *   resumed launch (TEST_AGENT_RESUME) takes the answer as its prompt and works on as `work` does.
 * - ask-then-stuck: as ask, but the resumed launch reports `norn stuck`.
 * - hang: notes its pid, leaves an untracked file, then stays alive firing no hook and never
 *   reports; a resumed launch hangs the same way.
 * - protocol: the refusals an agent can meet (an outcome the step lacks, verbs without the run's env
 *   or under a made-up run, a handoff over 8 KB), then a handoff of its own, `norn done done` and a
 *   second report. It holds the ticks meanwhile with `$TEST_AGENT_NOTES/hold`, which a test's ticks
 *   wait out, so no tick ends the run between the two reports.
 * - findings: `norn done changes_requested --findings <file>`.
 * - attended: a stop before reporting, then `norn done done`.
 * - permission: leaves a merge in progress, then asks permission for a shell call and waits for keys
 *   typed into its herdr pane (FAKE_HERDR_INPUT, fixtures/fake-herdr); once they come the call runs,
 *   a second call asks and waits the same way, then it commits the merge and reports done.
 * - trust: waits for keys in its pane before it fires any hook, as an agent behind a trust dialog
 *   does whose hooks have not loaded, then works as `work` does. The wait is read from
 *   TEST_AGENT_PLAN alone, since a plans file is read only after the first hooks.
 * - report: the reports TEST_AGENT_REPORTS names for the visit (`"<step>#<attempt>"`, then
 *   `"<step>"`): `{criteria?, tries}`, each try a `norn` verb's argv run in turn, the criteria
 *   report written outside the worktree and passed to each try as `--criteria <file>`.
 * - resolve: merges the base commit its `base_side` input names (the conflict norn aborted), keeps
 *   both sides of every conflicted path, commits the merge and reports done. A script at
 *   `$TEST_FLAGS/before-report.sh` runs once between the commit and the report, so a test can move
 *   the base under a resolver that has just finished.
 * - resolve-ask: merges as resolve does, resolves and stages only the last conflicted path, then
 *   asks with the merge kept in progress; the resumed launch notes the merge it found, resolves the
 *   rest, commits and reports done.
 * - slicer: writes the slice files TEST_AGENT_SLICES lists (`[{file, depends_on?}]`, default
 *   `01-form.md` and `02-list.md`, independent) into the story's spec folder, commits `plan.txt`
 *   and reports done.
 * - slice-work: as a slice's build step: writes `<slug>.txt` (the slug of its slice file's name)
 *   naming the unit, commits it and reports done.
 * - slice-ask: asks first; the resumed launch works as slice-work does.
 * - logged-out: its start hook, then a line on stdout and an exit 1 before any prompt, as `claude -p`
 *   does without a login (TEST_AGENT_PLAN only: it exits before the brief that names the step).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HOOK_FILE } from "./plugin.ts";

const cwd = process.cwd();
const hookCommand = (await Bun.file(join(cwd, HOOK_FILE)).text()).trim();
// a bare `norn`, as the brief tells an agent to run it: the launcher's PATH must make it this build
const norn = "norn";
const notesDir = process.env.TEST_AGENT_NOTES as string;
const runId = process.env.NORN_RUN_ID as string;
const unit = process.env.NORN_UNIT ?? "";
const resumed = process.env.TEST_AGENT_RESUME;
const prompt = process.argv[2] ?? "";
/** A run id no launch made: the shape of one, so only the run check refuses it. */
const MADE_UP_RUN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const note = (what: string, value: unknown) => appendFileSync(join(notesDir, `${runId}.jsonl`), `${JSON.stringify({ note: what, value })}\n`);

async function sh(command: string, input = ""): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(["sh", "-c", command], { cwd, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** One hook as a coding agent runs it: the installed command, the hook's name last, the payload on stdin. */
async function hook(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const out = await sh(`${hookCommand} ${name}`, JSON.stringify(payload));
  if (out.stderr.trim()) note(`${name}.stderr`, out.stderr.trim());
  if (out.code !== 0) note(`${name}.exit`, out.code);
  if (!out.stdout.trim()) return { kind: "allow" };
  try {
    return JSON.parse(out.stdout);
  } catch {
    return { kind: "unreadable", text: out.stdout };
  }
}

/** A `norn` verb with `--json`, behind an optional env prefix: its exit code and its one JSON value. */
async function nornJson(args: string[], prefix = ""): Promise<{ code: number; body: unknown }> {
  const out = await sh(`${prefix}${norn} ${args.map(quote).join(" ")} --json`);
  let body: unknown = out.stdout;
  try {
    body = JSON.parse(out.stdout);
  } catch {
    // kept as text: the test shows what came out instead of a JSON value
  }
  return { code: out.code, body };
}

async function git(...args: string[]): Promise<void> {
  const out = await sh(`git ${args.map(quote).join(" ")}`);
  if (out.code !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
}

/** `TEST_AGENT_ONLY=<note>` in a detached process: outlives a stop sent to the agent's group. */
function detached(what: string): Promise<void> {
  const child = spawn(process.execPath, [import.meta.path], { cwd, env: { ...process.env, TEST_AGENT_ONLY: what }, detached: true, stdio: "ignore" });
  return new Promise((resolve) => {
    child.on("exit", () => resolve());
    child.on("error", (e) => {
      note(`${what}.error`, String(e));
      resolve();
    });
  });
}

/** The plan for this visit: the plans file's entry for the visit, then for the step, then TEST_AGENT_PLAN. */
function planFor(step: string | undefined, attempt: number | undefined): string {
  const fallback = process.env.TEST_AGENT_PLAN ?? "work";
  const file = process.env.TEST_AGENT_PLANS;
  if (!file || !existsSync(file) || step === undefined) return fallback;
  const plans = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  return plans[`${unit}:${step}#${attempt}`] ?? plans[`${unit}:${step}`] ?? plans[`${step}#${attempt}`] ?? plans[step] ?? fallback;
}

async function work(): Promise<void> {
  note("write.inside", await hook("tool", { id: "t-inside", kind: "write", tool: "Write", detail: join(cwd, "feature.txt") }));
  note("write.machine", await hook("tool", { id: "t-machine", kind: "write", tool: "Write", detail: join(cwd, "..", "..", "runtime", "x.json") }));
  await Bun.write(join(cwd, "feature.txt"), `the feature, by run ${runId}\n`);
  // everything the step left, as an agent commits its work: a rerun finds what an earlier visit left
  await git("add", "-A");
  await git("-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-q", "-m", "agent: feature.txt");
  await hook("tool-done", { id: "t-inside" });
  note("stop.before-report", await hook("stop"));
  note("done.bad", await nornJson(["done", "shipped"]));
  note("done", await nornJson(["done", "done"]));
  await detached("stop.after-report");
  // the tick that applies the report stops this process, so what follows may never run
  await hook("end");
}

/** Alive, firing no hook and never reporting, until something stops it. */
async function hang(): Promise<never> {
  note("pid", process.pid);
  if (!resumed) await Bun.write(join(cwd, "wip.txt"), "work in progress\n");
  setInterval(() => undefined, 1 << 30);
  return new Promise<never>(() => undefined);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Where the unit's handoff lives, when the brief names one. */
function handoffNamed(briefText: string): string | undefined {
  const named = briefText.match(/`(\.agents\/specs\/[^`]*handoffs\/[^`]*\.md)`/);
  return named ? join(cwd, named[1] as string) : undefined;
}

/** Under the hold: a tick applying the done would end the run before the second report. */
async function protocol(briefText: string): Promise<void> {
  note("done.nope.md", await sh(`${norn} done nope`));
  note("done.nope.json", await nornJson(["done", "nope"]));
  const bare = "env -u NORN_RUN_ID -u NORN_UNIT ";
  note("no_run_env", {
    brief: await nornJson(["brief"], bare),
    done: await nornJson(["done", "done"], bare),
    ask: await nornJson(["ask", "Why?"], bare),
    stuck: await nornJson(["stuck", "lost"], bare),
  });
  const madeUp = `NORN_RUN_ID=${MADE_UP_RUN} `;
  note("stale_run", { brief: await nornJson(["brief"], madeUp), done: await nornJson(["done", "done"], madeUp) });
  const handoff = handoffNamed(briefText);
  if (handoff === undefined) throw new Error("the protocol plan needs a step whose brief names a handoff");
  note("handoff.path", handoff);
  await Bun.write(handoff, `## State\n\n${"a diary of every attempt. ".repeat(400)}\n`);
  note("done.big-handoff", await nornJson(["done", "done"]));
  const kept = "## State\n\nThe protocol step left this for the next step: the handoff marker 7f3a.\n\n## Notes\n\n- nothing else\n";
  await Bun.write(handoff, kept);
  note("handoff.sha", sha256(readFileSync(handoff, "utf8")));
  note("git.status", (await sh("git status --porcelain")).stdout);
  note("done", await nornJson(["done", "done"]));
  note("second-report", await nornJson(["stuck", "a second report"]));
  rmSync(hold, { force: true });
  await hook("end");
}

/**
 * What was typed into the agent's pane, once it holds more than `after` characters ending in enter
 * (keys go in as separate calls, and a dialog acts on enter); null if nothing came.
 */
async function paneInput(after: number): Promise<string | null> {
  const file = process.env.FAKE_HERDR_INPUT;
  if (!file) throw new Error("this plan runs only in the fake herdr's pane");
  for (const until = Date.now() + 120_000; Date.now() < until; await Bun.sleep(100)) {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (text.length > after && text.endsWith("<enter>")) return text;
  }
  return null;
}

/** Two permission prompts, each waited out in the pane, over a merge left in progress. */
async function permission(): Promise<void> {
  await git("checkout", "-q", "-b", "side");
  await Bun.write(join(cwd, "side.txt"), "from the side branch\n");
  await git("add", "side.txt");
  await git("-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-q", "-m", "side");
  await git("checkout", "-q", "-");
  const head = (await sh("git rev-parse HEAD")).stdout.trim();
  await git("merge", "-q", "--no-ff", "--no-commit", "side");
  note("merging", { head, merge_head: (await sh("git rev-parse MERGE_HEAD")).stdout.trim() });
  let seen = 0;
  for (const [id, command] of [["t-rm", "rm -rf build"], ["t-rm2", "rm -rf dist"]] as const) {
    await hook("tool", { id, kind: "shell", tool: "Bash", detail: command });
    await hook("permission", { id, prompt: `Allow ${command}?` });
    const keys = await paneInput(seen);
    note(`keys.${id}`, keys);
    if (keys === null) process.exit(1);
    seen = keys.length;
    await hook("tool-done", { id });
  }
  await git("-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-q", "--no-edit");
  note("done", await nornJson(["done", "done"]));
  await hook("end");
}

/** The base commit the `base_side` input names, as the resolver is told to merge it. */
function baseToMerge(): string {
  const text = readFileSync(join(process.env.NORN_IN ?? join(cwd, ".agents", "run", "in"), "base_side.md"), "utf8");
  const sha = text.match(/git merge ([0-9a-f]{40})/)?.[1];
  if (sha === undefined) throw new Error(`base_side names no commit to merge:\n${text}`);
  return sha;
}

async function unmerged(): Promise<string[]> {
  return (await sh("git diff --name-only --diff-filter=U")).stdout.split("\n").filter(Boolean);
}

/** The merge as it stands: its MERGE_HEAD (null when none) and `git status --porcelain`. */
async function mergeState(): Promise<{ merge_head: string | null; porcelain: string }> {
  const mh = await sh("git rev-parse -q --verify MERGE_HEAD");
  return { merge_head: mh.code === 0 ? mh.stdout.trim() : null, porcelain: (await sh("git status --porcelain --untracked-files=no")).stdout };
}

/** Each path as both sides wrote it, the story's lines first, staged: a resolution that keeps the two. */
async function keepBoth(paths: string[]): Promise<void> {
  for (const path of paths) {
    const ours = await sh(`git show :2:${quote(path)}`);
    const theirs = await sh(`git show :3:${quote(path)}`);
    await Bun.write(join(cwd, path), `${ours.stdout}${theirs.stdout}`);
    await git("add", "--", path);
  }
}

async function commitAndReport(): Promise<void> {
  await git("-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-q", "--no-edit");
  const before = join(process.env.TEST_FLAGS ?? "", "before-report.sh");
  if (process.env.TEST_FLAGS && existsSync(before)) {
    const ran = await sh(`sh ${quote(before)}`);
    rmSync(before, { force: true });
    note("before-report", ran);
  }
  note("done", await nornJson(["done", "done"]));
  await hook("end");
}

/** `git merge <base>` as a resolver starts it: a conflict is what it expects. */
async function startMerge(): Promise<string[]> {
  const sha = baseToMerge();
  note("merging", sha);
  await sh(`git merge --no-ff --no-edit ${sha}`);
  const paths = await unmerged();
  note("conflicts", paths);
  return paths;
}

async function resolve(): Promise<void> {
  await keepBoth(await startMerge());
  await commitAndReport();
}

/** Part of the conflict resolved and staged, the rest left for the person's answer. */
async function resolveAsk(): Promise<void> {
  const paths = await startMerge();
  await keepBoth(paths.slice(-1));
  note("merge.at-ask", await mergeState());
  note("ask", await nornJson(["ask", "Which side of the conflict should win?"]));
  note("stop.after-ask", await hook("stop"));
  await hook("end");
}

async function resolveAnswered(): Promise<void> {
  note("merge.at-answer", await mergeState());
  await keepBoth(await unmerged());
  await commitAndReport();
}

interface Reports {
  criteria?: unknown[];
  tries: string[][];
}

/** Each try in turn, every outcome noted as `try.<n>`: a refused try is what a test looks at. */
async function report(step: string | undefined, attempt: number | undefined): Promise<void> {
  const file = process.env.TEST_AGENT_REPORTS;
  const all = (file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}) as Record<string, Reports>;
  const mine = all[`${step}#${attempt}`] ?? all[step ?? ""];
  if (!mine) throw new Error(`the report plan has nothing for ${step}#${attempt}`);
  // outside the worktree: a file left in it would make the done refused as uncommitted work
  const criteria = join(notesDir, `criteria-${runId}.json`);
  if (mine.criteria) await Bun.write(criteria, JSON.stringify(mine.criteria));
  for (const [i, argv] of mine.tries.entries()) note(`try.${i + 1}`, await nornJson(mine.criteria ? [...argv, "--criteria", criteria] : argv));
  await hook("end");
}

/** The story's spec folder in this worktree, where norn puts the story's documents and reads them back. */
const specFolder = () => join(cwd, ".agents", "specs", unit.split("/")[0] as string);

/** Slice files in the spec folder: the frontmatter decide reads and a one-line goal. */
async function slicer(): Promise<void> {
  const file = process.env.TEST_AGENT_SLICES;
  const listed = (file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [{ file: "01-form.md" }, { file: "02-list.md" }]) as { file: string; depends_on?: string[] }[];
  const story = unit.split("/")[0] as string;
  for (const s of listed) {
    const nn = s.file.split("-")[0] as string;
    const deps = (s.depends_on ?? []).map((d) => JSON.stringify(d)).join(", ");
    await Bun.write(join(specFolder(), "slices", s.file), ["---", `id: ${story}/${nn}`, `depends_on: [${deps}]`, "---", `## Goal`, "", `Slice ${nn}.`, ""].join("\n"));
  }
  note("slices.written", listed.map((s) => s.file));
  // a commit of the story's own, so its head is not the base's and a slice cut from the base shows
  await Bun.write(join(cwd, "plan.txt"), "the plan\n");
  await git("add", "plan.txt");
  await git("-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-q", "-m", "agent: plan.txt");
  note("done", await nornJson(["done", "done"]));
  await hook("end");
}

/** `<slug>.txt` for this slice, the slug taken from its slice file's name in the spec folder. */
async function sliceWork(): Promise<void> {
  const nn = unit.split("/")[1];
  const dir = join(specFolder(), "slices");
  const found = existsSync(dir) ? readdirSync(dir).find((f) => f.startsWith(`${nn}-`)) : undefined;
  if (nn === undefined || found === undefined) throw new Error(`slice-work: no slice file for ${unit} in ${dir}`);
  const name = `${found.replace(/^[0-9]+-/, "").replace(/\.md$/, "")}.txt`;
  note("slice.file", found);
  await Bun.write(join(cwd, name), `written by ${unit}\n`);
  await git("add", name);
  await git("-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-q", "-m", `agent: ${name} for ${unit}`);
  note("done", await nornJson(["done", "done"]));
  await hook("end");
}

if (process.env.TEST_AGENT_ONLY === "stop.after-report") {
  note("stop.after-report", await hook("stop"));
  process.exit(0);
}

if (process.env.TEST_AGENT_PLAN === "trust" && !resumed) note("trusted", await paneInput(0));
note(resumed ? "resume.start" : "start", await hook("start"));
if (process.env.TEST_AGENT_PLAN === "logged-out") {
  process.stdout.write("Not logged in · Please run /login\n");
  process.exit(1);
}
note(resumed ? "resume.prompt" : "prompt", await hook("prompt", { prompt }));
note("norn", (await sh("command -v norn")).stdout.trim());
const brief = await sh(`${norn} brief`);
// the brief's title names the visit: `# norn brief — <unit> · <step> #<attempt>`
const visit = brief.stdout.match(/· (\S+) #(\d+)/);
const plan = planFor(visit?.[1], visit ? Number(visit[2]) : undefined);
// ticks wait while this file exists, so it goes up as soon as the plan is known
const hold = join(notesDir, "hold");
if (plan === "protocol") await Bun.write(hold, runId);
note("brief", { code: brief.code, text: brief.stdout });
note("brief.json", await nornJson(["brief"]));
note("plan", plan);
const named = handoffNamed(brief.stdout);
if (named !== undefined) note("handoff.read", existsSync(named) ? readFileSync(named, "utf8") : null);

if (resumed) {
  note("answered", { session: resumed, prompt });
  if (plan === "hang") await hang();
  else if (plan === "resolve-ask") await resolveAnswered();
  else if (plan === "slice-ask") await sliceWork();
  else if (plan === "ask-then-stuck") {
    note("stuck", await nornJson(["stuck", "The answer leaves nothing to build."]));
    await hook("end");
  } else await work();
} else if (plan === "resolve") await resolve();
else if (plan === "resolve-ask") await resolveAsk();
else if (plan === "slicer") await slicer();
else if (plan === "slice-work") await sliceWork();
else if (plan === "ask" || plan === "ask-then-stuck" || plan === "slice-ask") {
  note("ask", await nornJson(["ask", "Which colour should the button be?"]));
  // the stop hook allows a run that has asked, and a non-interactive agent exits on that
  note("stop.after-ask", await hook("stop"));
  await hook("end");
} else if (plan === "hang") await hang();
else if (plan === "protocol") await protocol(brief.stdout);
else if (plan === "findings") {
  const file = join(notesDir, `findings-${runId}.json`);
  await Bun.write(file, JSON.stringify([{ severity: "blocking", title: "The button is the wrong colour", detail: "It should be blue." }]));
  note("done", await nornJson(["done", "changes_requested", "--findings", file]));
  await hook("end");
} else if (plan === "permission") await permission();
else if (plan === "report") await report(visit?.[1], visit ? Number(visit[2]) : undefined);
else if (plan === "attended") {
  note("stop.before-report", await hook("stop"));
  note("done", await nornJson(["done", "done"]));
  await hook("end");
} else await work();
process.exit(0);
