/**
 * `norn lab --tty`: the lab's tour in the terminal. It ticks the lab's story on, and once the story
 * is past a beat says that beat's caption and pauses for Enter, the story held where the caption
 * left it. At a beat that needs the person it prints
 * their exact command, with the lab's repo and norn home, and waits: Enter runs that command, or the
 * person runs it in another shell, which the tour sees in the story's state and moves on. Every state
 * is read from `norn status --json`, never from prose.
 */
import { refuse } from "../output.ts";
import type { LabPaths } from "./paths.ts";
import { beatOf, forStory, type LabBeatScript, type LabScript, type LabUnit, personCommand } from "./script.ts";

/** How long the tour waits between two reads of the story. */
export const TOUR_POLL_MS = 500;

export interface LabState {
  key: string | null;
  unit: LabUnit | null;
  /** the story's claim is held: once its unit ended, the next tick gives it up */
  claimed: boolean;
}

/** The person's typed lines: the next one, or null once the input ended. */
export interface LineInput {
  next(): Promise<string | null>;
}

/**
 * Lines from an iterator, the one being read kept across calls, so a line typed while the tour
 * looked elsewhere is the answer to its next prompt rather than lost.
 */
export function lineInput(lines: AsyncIterator<string> | AsyncIterable<string> | undefined): LineInput {
  const it = lines === undefined ? undefined : Symbol.asyncIterator in lines ? lines[Symbol.asyncIterator]() : lines;
  let reading: Promise<string | null> | null = null;
  let ended = it === undefined;
  return {
    next() {
      if (ended) return Promise.resolve(null);
      reading ??= (it as AsyncIterator<string>).next().then((r) => {
        reading = null;
        if (r.done) ended = true;
        return r.done ? null : r.value;
      });
      return reading;
    },
  };
}

export interface TourIo {
  state(): Promise<LabState>;
  tick(): Promise<void>;
  /** run a printed command as the person would in a shell of theirs */
  run(command: string): Promise<{ code: number; output: string }>;
  say(line: string): void;
  input: LineInput;
  sleep(ms: number): Promise<void>;
  signal?: AbortSignal;
}

/** A path or argument as a shell word: quoted only when it needs to be. */
export const shellWord = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** The person's command as they paste it in a shell of their own: a subshell in the lab's repo with its norn home, so their shell stays as it was. */
export function youLine(paths: LabPaths, command: string): string {
  return `(cd ${shellWord(paths.repo)} && export NORN_HOME_DIR=${shellWord(paths.home)} && ${command})`;
}

/** What tells one state of the unit from the next: a person's decision shows as a receipt not yet applied. */
const mark = (u: LabUnit | null): string => JSON.stringify(u === null ? null : [u.step, u.waiting, u.ended ?? null, u.counters, u.pending_receipts ?? 0]);

function tell(io: TourIo, beat: LabBeatScript, of: number, key: string): void {
  for (const l of ["", `## Beat ${beat.n} of ${of}: ${beat.title}`, "", forStory(beat.caption, key), "", `Look: ${forStory(beat.look, key)}`, ""]) io.say(l);
}

/** The next line, or null when the input ended or the tour is stopped. */
function line(io: TourIo): Promise<string | null> {
  const signal = io.signal;
  if (signal === undefined) return io.input.next();
  if (signal.aborted) return Promise.resolve(null);
  return Promise.race([io.input.next(), new Promise<null>((r) => signal.addEventListener("abort", () => r(null), { once: true }))]);
}

/**
 * Play the lab's story from its state to its end, or until the signal stops it. `shown` is the
 * last beat already told (0 for a new lab), so a resumed lab starts at its story's beat.
 */
export async function playTour(script: LabScript, paths: LabPaths, io: TourIo, shown: number): Promise<LabState> {
  const of = script.beats.length;
  let prompted: string | null = null;
  let step: string | null = null;
  for (;;) {
    const st = await io.state();
    const { key, unit } = st;
    if (io.signal?.aborted || key === null) return st;
    if (unit === null) {
      await io.tick();
      await io.sleep(TOUR_POLL_MS);
      continue;
    }
    const beat = beatOf(script, unit);
    // a decision on its way (a receipt the next tick applies) is not asked for again
    const you = (unit.pending_receipts ?? 0) === 0 ? personCommand(beat, unit, key) : null;
    // a caption says what happened, so a beat is told once the story is past it; the beat a decision
    // is due at is told as it waits on that decision, which it then waits on alone
    const due = unit.ended !== undefined ? of : you !== null ? beat.n : beat.n - 1;
    while (shown < due) {
      shown++;
      tell(io, script.beats[shown - 1] as LabBeatScript, of, key);
      if (shown < due || (you === null && unit.ended === undefined)) {
        io.say("Press Enter to go on.");
        await line(io);
        if (io.signal?.aborted) return st;
      }
    }
    if (unit.step !== step && unit.ended === undefined) {
      step = unit.step;
      io.say(`· step ${step}`);
    }
    // the claim is given up on a tick after the one that ended the unit: the story ends only once it is
    if (unit.ended !== undefined && st.claimed) {
      await io.tick();
      continue;
    }
    if (unit.ended !== undefined) {
      io.say(`The story ended \`${unit.ended}\`. \`norn lab --clean\` plays the lab again from beat 1.`);
      return st;
    }
    const now = mark(unit);
    if (you !== null && now !== prompted) {
      prompted = now;
      await decide(io, paths, unit, youLine(paths, you), now);
      continue;
    }
    if (unit.waiting !== null && you === null && now !== prompted && (unit.pending_receipts ?? 0) === 0) {
      prompted = now;
      io.say(`Waiting for you: ${unit.waiting.text}${unit.waiting.next ? ` → ${unit.waiting.next}` : ""}`);
    }
    await io.tick();
    await io.sleep(TOUR_POLL_MS);
  }
}

/** Print the person's command and wait: Enter runs it, or the story moving on shows they ran it elsewhere. */
async function decide(io: TourIo, paths: LabPaths, unit: LabUnit, command: string, now: string): Promise<void> {
  io.say("");
  if (unit.waiting !== null) io.say(`Your move: ${unit.waiting.text}`);
  io.say("Run it in another shell, or press Enter and the lab runs it:");
  io.say("");
  io.say(`    ${command}`);
  io.say("");
  let watching = true;
  const moved = (async () => {
    while (watching && !io.signal?.aborted) {
      await io.sleep(TOUR_POLL_MS);
      if (!watching) return false;
      await io.tick();
      if (mark((await io.state()).unit) !== now) return true;
    }
    return false;
  })();
  const first = await Promise.race([moved.then((m) => (m ? ("moved" as const) : ("stopped" as const))), line(io).then(() => "enter" as const)]);
  watching = false;
  if (first !== "enter") {
    if (first === "moved") io.say("You ran it: the story moved on.");
    return;
  }
  // the watch may be mid-tick; the command runs after it, so the two never race on the story
  if (await moved) {
    io.say("You ran it: the story moved on.");
    return;
  }
  if (io.signal?.aborted) return;
  const r = await io.run(command);
  if (r.code !== 0) throw refuse(`norn lab ran \`${command}\`, which exited ${r.code}: ${r.output.trim().slice(0, 2000)}`, `run it yourself from ${paths.repo}, then \`norn lab --tty\` again`, "lab_failed");
  for (const l of r.output.trim().split("\n")) if (l !== "") io.say(`  ${l}`);
}
