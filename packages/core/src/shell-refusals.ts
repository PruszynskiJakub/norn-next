/**
 * Which hard rule a shell command breaks, judged per segment by a small tokenizer, never a shell
 * parser. It errs toward allow: a command it cannot read (an unterminated quote, a heredoc) breaks
 * no rule, because a false refusal blocks legitimate work while a missed one is still forbidden by
 * the brief.
 */
import type { HardRuleId } from "./hard-rules.ts";

const SEPARATORS = new Set([";", "&", "|", "\n", "(", ")", "`"]);

/** The command's segments, each as its words with quotes removed; null when it cannot be read. */
function segments(command: string): string[][] | null {
  const out: string[][] = [];
  let words: string[] = [];
  let word: string | null = null;
  let quote: "'" | '"' | null = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && i + 1 < command.length) word = `${word ?? ""}${command[++i]}`;
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "\\") {
      if (command[i + 1] === "\n") i++;
      else if (i + 1 < command.length) word = (word ?? "") + command[++i];
    } else if (c === "<" && command[i + 1] === "<") {
      return null; // a heredoc's body is data, and only a shell can tell where it ends
    } else if (c === "#" && word === null) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
    } else if (SEPARATORS.has(c)) {
      endSegment();
    } else if (c === " " || c === "\t") {
      endWord();
    } else {
      word = (word ?? "") + c;
    }
  }
  if (quote) return null;
  endSegment();
  return out;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const program = (word: string) => word.slice(word.lastIndexOf("/") + 1);

/** The program and its arguments, leading env assignments skipped. */
function invocation(words: string[]): { prog: string; args: string[] } | null {
  const start = words.findIndex((w) => !ENV_ASSIGNMENT.test(w));
  if (start < 0) return null;
  return { prog: program(words[start] as string), args: words.slice(start + 1) };
}

/** Skip leading options, those in `withValue` taking the next word, to the first word that is not one. */
function afterOptions(args: string[], withValue: ReadonlySet<string>): string[] {
  let i = 0;
  while (i < args.length && (args[i] as string).startsWith("-")) i += withValue.has(args[i] as string) ? 2 : 1;
  return args.slice(i);
}

const GIT_VALUE_OPTIONS = new Set(["-C", "-c"]);
const CHECKOUT_SWITCH_FLAGS = new Set(["-b", "-B", "--orphan", "--detach", "-"]);

/** The name a bare `git checkout <name>` would switch to, if it names a commit; null for any other checkout. */
function bareCheckoutName(args: string[]): string | null {
  if (args.includes("--")) return null;
  const names = args.filter((a) => !a.startsWith("-"));
  return names.length === 1 ? (names[0] as string) : null;
}

function gitRule(args: string[], commits: ReadonlySet<string>): HardRuleId | null {
  const [sub, ...rest] = afterOptions(args, GIT_VALUE_OPTIONS);
  if (sub === "push") return "no-push";
  if (sub === "switch") return "no-switch";
  if (sub === "worktree" && ["add", "move", "remove"].includes(rest[0] ?? "")) return "no-switch";
  if (sub !== "checkout") return null;
  if (rest.some((a) => CHECKOUT_SWITCH_FLAGS.has(a))) return "no-switch";
  const name = bareCheckoutName(rest);
  return name !== null && commits.has(name) ? "no-switch" : null;
}

const FORGE_VALUE_OPTIONS = new Set(["-R", "--repo"]);
const REVIEW_WRITES = new Set(["create", "edit", "comment", "review", "ready", "merge", "close", "reopen"]);
const GROUP_WRITES: Record<string, ReadonlySet<string>> = {
  label: new Set(["create", "edit", "delete", "clone"]),
  release: new Set(["create", "delete"]),
  repo: new Set(["edit", "delete"]),
};
const API_FIELD_FLAGS = ["-f", "-F", "--field", "--raw-field", "--input"];

/** `api` writes unless every method it names is GET and it sends no field or input. */
function apiWrites(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (API_FIELD_FLAGS.some((f) => a === f || a.startsWith(`${f}=`) || (f.length === 2 && a.startsWith(f)))) return true;
    let method: string | undefined;
    if (a === "-X" || a === "--method") method = args[++i];
    else if (a.startsWith("--method=")) method = a.slice("--method=".length);
    else if (a.startsWith("-X")) method = a.slice(2);
    if (method !== undefined && method.toUpperCase() !== "GET") return true;
  }
  return false;
}

function forgeRule(prog: "gh" | "glab", args: string[]): HardRuleId | null {
  const [group = "", action = "", ...rest] = afterOptions(args, FORGE_VALUE_OPTIONS);
  const review = prog === "gh" ? "pr" : "mr";
  if (group === review && action === "checkout") return "no-switch";
  if ((group === review || group === "issue") && REVIEW_WRITES.has(action)) return "no-remote-write";
  if (GROUP_WRITES[group]?.has(action)) return "no-remote-write";
  if (group === "api" && apiWrites([action, ...rest])) return "no-remote-write";
  return null;
}

/** The hard rule `command` breaks, or null; `commits` are the names the cli resolved to a commit. */
export function shellRefusal(command: string, commits: readonly string[] = []): HardRuleId | null {
  const known = new Set(commits);
  for (const words of segments(command) ?? []) {
    const call = invocation(words);
    if (!call) continue;
    const rule = call.prog === "git" ? gitRule(call.args, known) : call.prog === "gh" || call.prog === "glab" ? forgeRule(call.prog, call.args) : null;
    if (rule) return rule;
  }
  return null;
}

/** The names of bare `git checkout <name>` segments: the one fact the cli gathers (does it resolve to a commit) before core decides. */
export function checkoutNames(command: string): string[] {
  const names: string[] = [];
  for (const words of segments(command) ?? []) {
    const call = invocation(words);
    if (call?.prog !== "git") continue;
    const [sub, ...rest] = afterOptions(call.args, GIT_VALUE_OPTIONS);
    if (sub !== "checkout" || rest.some((a) => CHECKOUT_SWITCH_FLAGS.has(a))) continue;
    const name = bareCheckoutName(rest);
    if (name !== null) names.push(name);
  }
  return names;
}
