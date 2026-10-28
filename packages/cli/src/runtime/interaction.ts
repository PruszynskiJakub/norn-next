/**
 * The terminal interaction (D2): the one place norn asks a person something at the terminal. Kept
 * thin; tests script it (the harness's `FakeInteraction`). A session is interactive when it has a TTY
 * on stdin and stdout, the command was not given `--json`, and it is not an agent session — the launch
 * env of A6 or the orient env present. Anywhere else a prompt is a refusal that names the candidates (B60).
 */
import { ORIENT_ENV } from "./agent-unit.ts";

export interface InteractionChoice {
  value: string;
  label: string;
}

export interface Interaction {
  /** a TTY on stdin and stdout */
  readonly tty: boolean;
  /** one of `choices`, starting at `preselect`; null when the person leaves (Esc, Ctrl-C) */
  pick(question: string, choices: readonly InteractionChoice[], preselect: number): Promise<string | null>;
  /** y/N: true only when the person answers y (yes) */
  confirm(question: string): Promise<boolean>;
}

/** A6: what norn sets when it launches an agent; the orient env marks the agent beside a person. */
export function isAgentSession(env: Record<string, string | undefined>): boolean {
  return !!env.NORN_RUN || env[ORIENT_ENV] === "1";
}

const ESC = "\x1b";
const KEYS = { up: [`${ESC}[A`, "k"], down: [`${ESC}[B`, "j"], pick: ["\r", "\n"], leave: [ESC, "\x03", "q"] };

/** The process terminal: a pick-list drawn on stderr, arrows (or j/k) move, Enter picks, Esc / Ctrl-C / q leave. */
export function terminalInteraction(): Interaction {
  const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
  return {
    tty,
    async pick(question, choices, preselect) {
      if (!tty || !choices.length) return null;
      const out = process.stderr;
      let at = Math.min(Math.max(preselect, 0), choices.length - 1);
      const draw = (first: boolean) => {
        if (!first) out.write(`${ESC}[${choices.length}A`);
        for (const [i, c] of choices.entries()) out.write(`${ESC}[2K${i === at ? "> " : "  "}${c.label}\n`);
      };
      out.write(`${question} (↑/↓, Enter to pick, Esc to leave)\n`);
      draw(true);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      try {
        for await (const chunk of stdin) {
          // one chunk may hold several keys (typed ahead, pasted)
          for (const key of chunk.toString().match(/\x1b\[[A-D]|[\s\S]/g) ?? []) {
            if (KEYS.pick.includes(key)) return choices[at]?.value ?? null;
            if (KEYS.leave.includes(key)) return null;
            if (KEYS.up.includes(key)) at = (at + choices.length - 1) % choices.length;
            else if (KEYS.down.includes(key)) at = (at + 1) % choices.length;
            else continue;
            draw(false);
          }
        }
        return null;
      } finally {
        stdin.setRawMode(false);
        stdin.pause();
      }
    },
    async confirm(question) {
      if (!tty) return false;
      process.stderr.write(`${question} `);
      const stdin = process.stdin;
      stdin.resume();
      try {
        for await (const chunk of stdin) return /^\s*y(es)?\s*$/i.test(chunk.toString());
        return false;
      } finally {
        stdin.pause();
      }
    },
  };
}
