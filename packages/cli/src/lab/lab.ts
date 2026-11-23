/**
 * Building, resuming and cleaning a lab. Every child process goes through the host's exec (the one IO
 * boundary), and norn itself runs as a child on this same binary with the lab's own norn home, so the
 * process boundary keeps the person's norn home and repos out of reach, and every answer is read
 * from `--json`.
 */
import { type HostContext, parseJson, RUN_ENV } from "@norn/plugin-api";
import { SDLC_LAB } from "@norn/pack-sdlc";
import { WRITES_ENV } from "@norn/runtime";
import { Type } from "@sinclair/typebox";
import { configPaths } from "../config/paths.ts";
import { refuse } from "../output.ts";
import { labAgentBeatsFile, type LabPaths } from "./paths.ts";
import { beatOf, forStory, labAgentBeats, type LabBeatScript, type LabScript, labScript, LabUnit, nextCommand } from "./script.ts";
import { type LabState, type LineInput, playTour, shellWord } from "./tty.ts";

/** The one config line that names the lab's agent, and the comment above it on how to swap it. */
const LAB_EXECUTOR_LINE = "# the stand-in agent; set this line to {harness: claude, runner: headless} (or runner: herdr) for a real one\n  lab: { harness: lab, runner: headless }";

/** Who the lab's first commit is by. */
const SEEDER = { name: "norn lab", email: "lab@norn.invalid" };
const BASE = "main";
export const CHILD_TIMEOUT_MS = 120_000;
const CLEAN = "norn lab --clean";

export interface LabView {
  root: string;
  repo: string;
  remote: string;
  home: string;
  /** this run built the lab; false when it resumed one */
  built: boolean;
  /** the lab's story, once it exists */
  story: string | null;
  beat: { n: number; of: number; title: string; caption: string; look: string };
  /** what the story waits on the person for, as status shows it */
  waiting: LabUnit["waiting"];
  /** how the story ended, once it did */
  ended: string | null;
  /** the command that moves it on; null once it ended */
  next: string | null;
}

/** The part of `norn status --json` the lab reads. */
const StatusJson = Type.Object({ stories: Type.Array(Type.Object({ key: Type.String({ minLength: 1 }), units: Type.Array(LabUnit) })), intake: Type.Array(Type.Object({ key: Type.String({ minLength: 1 }) })) });

export interface LabRun {
  host: HostContext;
  paths: LabPaths;
  /** how this binary is invoked, so the lab's norn is the same build */
  self: readonly string[];
}

/** The env every child of the lab runs with: the lab's norn home, and no launch env of a session above it. */
export function labEnv(paths: LabPaths): Record<string, string> {
  return { NORN_HOME_DIR: paths.home, HERDR_ENV: "", [RUN_ENV.unit]: "", [RUN_ENV.run]: "", [WRITES_ENV]: "" };
}

async function run(lab: LabRun, what: string, argv: string[], cwd: string): Promise<string> {
  const r = await lab.host.exec(argv, { cwd, env: labEnv(lab.paths), timeoutMs: CHILD_TIMEOUT_MS });
  if (r.code !== 0) throw refuse(`norn lab could not ${what}: \`${argv.join(" ")}\` exited ${r.code}: ${(r.stderr.trim() || r.stdout.trim()).slice(0, 2000)}`, `start the lab again with \`${CLEAN}\``, "lab_failed");
  return r.stdout;
}

const norn = (lab: LabRun, what: string, args: string[]) => run(lab, what, [...lab.self, ...args, "--json"], lab.paths.repo);

/** The repo with the toy app on its base, pushed to a bare remote; norn set up in it; the story created. */
async function build(lab: LabRun, script: LabScript): Promise<void> {
  const { root, repo, remote } = lab.paths;
  const git = (what: string, ...args: string[]) => run(lab, what, ["git", ...args], repo);
  await lab.host.files.write(`${root}/README`, "A norn lab: `norn lab` resumes it, `norn lab --clean` starts it again.\n");
  await run(lab, "create the lab's remote", ["git", "init", "-q", "--bare", "-b", BASE, remote], root);
  await run(lab, "create the lab's repo", ["git", "init", "-q", "-b", BASE, repo], root);
  for (const [path, text] of Object.entries(SDLC_LAB.app)) await lab.host.files.write(`${repo}/${path}`, text);
  await git("add the toy app", "add", "-A");
  await git("commit the toy app", "-c", `user.name=${SEEDER.name}`, "-c", `user.email=${SEEDER.email}`, "commit", "-q", "-m", "The toy app and its test");
  await git("add the lab's remote", "remote", "add", "origin", remote);
  await git("push the toy app", "push", "-q", "-u", "origin", BASE);
  await norn(lab, "set norn up", ["init", "--tracker", "local", "--forge", "none", "--store", "local", "--executor", "lab", "--runner", "headless", "--mode", "auto", "--yes"]);
  await oneExecutorLine(lab);
  await norn(lab, "set the toy test as the check", ["config", "set", "checks.test", script.check]);
  await norn(lab, `set ${script.workflow} as the stories' workflow`, ["config", "set", "kernel.workflow", script.workflow]);
  await writeAgentBeats(lab);
  await norn(lab, "create the lab's story", ["story", "create", script.story.title, "--body", script.story.body, "--workflow", script.workflow]);
}

/** The executor init wrote, as the block YAML renders it. */
export const EXECUTOR_BLOCK = "executors:\n  lab:\n    harness: lab\n    runner: headless\n";

/**
 * The lab's executor as one line of its config, with a comment saying how to swap the stand-in for a
 * real agent, so trying one is an edit of that line.
 */
async function oneExecutorLine(lab: LabRun): Promise<void> {
  const file = configPaths(lab.paths.home, lab.paths.repo).local;
  const text = await lab.host.files.read(file);
  if (text === null || !text.includes(EXECUTOR_BLOCK)) throw refuse(`norn lab could not find the lab executor init writes in ${file}`, `start the lab again with \`${CLEAN}\``, "lab_failed");
  await lab.host.files.write(file, text.replace(EXECUTOR_BLOCK, `executors:\n  ${LAB_EXECUTOR_LINE}\n`));
}

/** The stand-in's beats, where `norn lab-agent` finds them; written on every run, so a newer norn plays its own. */
async function writeAgentBeats(lab: LabRun): Promise<void> {
  await lab.host.files.write(labAgentBeatsFile(lab.paths.home), `${JSON.stringify(labAgentBeats(), null, 2)}\n`);
}

/** The lab's story and its unit, read from `norn status --json`. */
async function storyState(lab: LabRun): Promise<{ key: string | null; unit: LabUnit | null }> {
  const out = await norn(lab, "read the lab's status", ["status"]);
  const r = parseJson(StatusJson, out, "norn status --json");
  if (!r.ok) throw refuse(`norn lab could not read the lab's status: ${r.failure.message}`, `start the lab again with \`${CLEAN}\``, "lab_failed");
  const story = r.value.stories[0];
  if (story !== undefined) return { key: story.key, unit: story.units[0] ?? null };
  return { key: r.value.intake[0]?.key ?? null, unit: null };
}

/**
 * Open the lab: build it when there is none (or `clean` removed it), else resume it, and place its
 * story in its beat. Only the lab's own folder is removed, and only under the temp directory.
 */
export async function openLab(lab: LabRun, opts: { clean: boolean }): Promise<LabView> {
  const script = labScript();
  const { root, repo } = lab.paths;
  const exists = !opts.clean && (await lab.host.files.read(`${repo}/.git/HEAD`)) !== null;
  if (exists) await writeAgentBeats(lab);
  else {
    // a half-built lab, a failed build's, goes too: the lab is built whole or not at all
    await run(lab, "remove the old lab", ["rm", "-rf", root], "/");
    await build(lab, script);
  }
  const { key, unit } = await storyState(lab);
  return placeInBeat(lab.paths, !exists, key, unit);
}

export interface TtyIo {
  /** where the tour's lines go, as they happen */
  say(line: string): void;
  input: LineInput;
  sleep(ms: number): Promise<void>;
  signal?: AbortSignal;
}

/**
 * Open the lab and play its tour in the terminal (`tty.ts`) to the story's end, or until the signal
 * stops it. The person's commands the lab runs on Enter run in a shell as printed, with `norn` this
 * same build, so the command the person reads is the one that ran.
 */
export async function playLab(lab: LabRun, opts: { clean: boolean }, io: TtyIo): Promise<LabView> {
  const script = labScript();
  const start = await openLab(lab, opts);
  io.say(labWhere(start).join("\n"));
  const shell = `norn() { ${lab.self.map(shellWord).join(" ")} "$@"; }`;
  const end: LabState = await playTour(
    script,
    lab.paths,
    {
      ...io,
      state: () => storyState(lab),
      tick: async () => void (await norn(lab, "tick the lab's story", ["tick"])),
      run: async (command) => {
        const r = await lab.host.exec(["sh", "-c", `${shell}\n${command}`], { cwd: lab.paths.repo, env: labEnv(lab.paths), timeoutMs: CHILD_TIMEOUT_MS });
        return { code: r.code, output: `${r.stdout}${r.stderr}` };
      },
    },
    start.built || start.story === null ? 0 : start.beat.n - 1,
  );
  return placeInBeat(lab.paths, start.built, end.key, end.unit);
}

/** The lab as its story's state places it in its beat: the view `norn lab` prints and the dashboard shows. */
export function placeInBeat(paths: LabPaths, built: boolean, key: string | null, unit: LabUnit | null): LabView {
  const script = labScript();
  const beat: LabBeatScript = beatOf(script, unit);
  const said = (text: string) => (key === null ? text : forStory(text, key));
  return {
    ...paths,
    built,
    story: key,
    beat: { n: beat.n, of: script.beats.length, title: beat.title, caption: said(beat.caption), look: said(beat.look) },
    waiting: unit?.waiting ?? null,
    ended: unit?.ended ?? null,
    next: nextCommand(script, beat, key, unit),
  };
}

/** Where the lab is, and how a person runs norn in it. */
function labWhere(v: LabView): string[] {
  return [
    "# norn lab",
    "",
    v.built ? `Built a new lab in ${v.root}.` : `Resumed the lab in ${v.root}.`,
    "",
    `- repo: ${v.repo}`,
    `- remote: ${v.remote}, standing in for a code host`,
    `- norn home: ${v.home}, the lab's own`,
    "",
    "Run every command from the lab's repo, with its norn home:",
    "",
    `    cd ${v.repo}`,
    `    export NORN_HOME_DIR=${v.home}`,
    "",
  ];
}

export function labMarkdown(v: LabView): string {
  const lines = [
    ...labWhere(v),
    `## Beat ${v.beat.n} of ${v.beat.of}: ${v.beat.title}`,
    "",
    v.beat.caption,
    "",
    `Look: ${v.beat.look}`,
    "",
  ];
  if (v.waiting !== null) lines.push(`Waiting for you: ${v.waiting.text}`, "");
  if (v.next !== null) lines.push(`Next: \`${v.next}\``);
  else lines.push(`The story ended \`${v.ended}\`. \`${CLEAN}\` plays the lab again from beat 1.`);
  return lines.join("\n");
}
