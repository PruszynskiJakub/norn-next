/**
 * The one translation of a workflow or shared file from the old wording (`type:` plus `skill:`,
 * `instructions:`, `run:`, `prompt:`, `action:`; `means`/`verdict` inside an edge) to the new one
 * (one head key per step, `skills:`, `by:`, sibling `means:`/`verdict:` maps). `norn upgrade` writes
 * its text and a copy read loads it, so both always agree.
 *
 * YAML is rewritten by splicing the source text at the parsed nodes' ranges, never by re-serialising
 * the document: every byte outside what changes, and the text of every scalar that moves, stays as
 * written. Where that cannot hold (a comment with no line left to sit on, a multi-line scalar that
 * would land at an indent it does not fit), the file is refused naming the line, never reflowed.
 */
import { isMap, isScalar, type Node, type Pair, parse, parseDocument, stringify, type YAMLMap } from "yaml";

export type Translated = { ok: true; text: string; changed: boolean } | { ok: false; file: string; line: number; message: string };

// Route overrides an agent never reports with `norn done`: they need no meaning
const OVERRIDABLE = new Set(["silent", "died", "timeout", "stalled", "ask", "stuck"]);
const CONTENT_KEY: Record<string, string> = { agent: "instructions", check: "run", gate: "prompt" };
const COPY_RENAME: Record<string, string> = { instructions: "agent", run: "check", prompt: "gate" };
const GIT_VERBS: Record<string, string> = { update: "update-branch", "open-pr": "open-pr", integrate: "integrate", push: "push" };
const OLD_STEP_KEYS = ["type", "skill", "instructions", "run", "prompt", "action"];
const EDGE_PROSE = ["means", "verdict"];

class Refusal extends Error {
  constructor(
    readonly pos: number,
    message: string,
  ) {
    super(message);
  }
}

/** Translate `text` (named `file` in a refusal) to the new wording; a text already in it comes back unchanged. */
export function translateWording(text: string, file: string): Translated {
  try {
    const json = jsonValue(text);
    const out = json !== undefined ? translateJson(text, json) : translateYaml(text);
    return { ok: true, text: out, changed: out !== text };
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    return { ok: false, file, line: lineOf(text, e.pos), message: e.message };
  }
}

const lineOf = (text: string, pos: number) => text.slice(0, pos).split("\n").length;
const plain = (s: string) => stringify(s, { lineWidth: 0 }).trimEnd();
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// ---- JSON: no comments and no layout to keep but the key order, written back with two-space indent

function jsonValue(text: string): unknown {
  if (!text.trimStart().startsWith("{")) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function translateJson(text: string, doc: unknown): string {
  const out = translateWordingValue(doc);
  return out === doc ? text : `${JSON.stringify(out, null, 2)}${text.endsWith("\n") ? "\n" : ""}`;
}

/**
 * A parsed workflow or shared file in the new wording: the same translation as `translateWording`'s,
 * on the value, so a copy loads whatever its layout (a flow-map step, an anchor) even where a lossless
 * rewrite of its text would be refused. A value with no step in the old wording comes back as it is.
 */
export function translateWordingValue(doc: unknown): unknown {
  if (!isObj(doc) || !isObj(doc.steps)) return doc;
  const steps = doc.steps;
  if (!Object.values(steps).some((s) => isObj(s) && isOldStep(s))) return doc;
  const out: Obj = {};
  for (const [name, step] of Object.entries(steps)) out[name] = isObj(step) ? translateStepObj(name, step, steps) : step;
  return { ...doc, steps: out };
}

/**
 * A text to read, not to keep, in the new wording: a text with no step in the old wording (or one that
 * is not YAML, left for the reader to refuse) comes back as it is; otherwise its translated value as YAML.
 */
export function inNewWording(text: string): string {
  let value: unknown;
  try {
    value = parse(text);
  } catch {
    return text;
  }
  const out = translateWordingValue(value);
  return out === value ? text : stringify(out, { lineWidth: 0, aliasDuplicateObjects: false });
}

function isOldStep(s: Obj): boolean {
  return oldKeys(s).length > 0;
}

/** The old-wording keys of one step: its own, then `means`/`verdict` found inside an edge or an exit route. */
function oldKeys(s: Obj): string[] {
  const own = OLD_STEP_KEYS.filter((k) => k in s);
  const edges = isObj(s.outcomes) ? Object.values(s.outcomes).filter(isObj) : [];
  const inEdge = EDGE_PROSE.filter((k) => edges.some((e) => k in e)).map((k) => `${k} inside an edge`);
  return [...own, ...inEdge];
}

/**
 * The steps of a parsed workflow or shared file written in the old wording, each with its old keys;
 * empty for a file in the new wording. The same test the translator uses, so what a main-checkout
 * read refuses is exactly what `norn upgrade` rewrites.
 */
export function oldWordingSteps(doc: unknown): Array<{ step: string; keys: string[] }> {
  if (!isObj(doc) || !isObj(doc.steps)) return [];
  return Object.entries(doc.steps).flatMap(([step, s]) => {
    const keys = isObj(s) ? oldKeys(s) : [];
    return keys.length ? [{ step, keys }] : [];
  });
}

function translateStepObj(name: string, s: Obj, steps: Obj): Obj {
  const kind = typeof s.type === "string" ? s.type : undefined;
  const agent = isAgentObj(s, steps, new Set());
  const out: Obj = {};
  if (kind !== undefined) out[headKey(kind, typeof s.action === "string" ? s.action : undefined, 0)] = headValueObj(name, kind, s);
  const means: Obj = {};
  const verdict: Obj = {};
  for (const [k, v] of Object.entries(s)) {
    if (kind !== undefined && (k === "type" || k === "action" || k === CONTENT_KEY[kind])) continue;
    if (k === "skill") out.skills = [v];
    // in a file in the old wording a copy's `agent:` is the agent's name too, never an orientation
    else if (k === "agent" && (kind !== undefined || typeof s.like === "string")) out.by = v;
    else if (kind === undefined && COPY_RENAME[k]) out[COPY_RENAME[k] as string] = v;
    else if (k === "outcomes" && isObj(v)) {
      const routes: Obj = {};
      for (const [o, e] of Object.entries(v)) {
        if (!isObj(e)) {
          routes[o] = e;
          if (agent && !OVERRIDABLE.has(o)) means[o] = `step finished with outcome ${o}`;
          continue;
        }
        const rest = Object.fromEntries(Object.entries(e).filter(([ek]) => !EDGE_PROSE.includes(ek)));
        routes[o] = Object.keys(rest).length === 1 && "to" in rest ? rest.to : rest;
        if (agent) {
          if (e.means !== undefined) means[o] = e.means;
          else if (!OVERRIDABLE.has(o)) means[o] = `step finished with outcome ${o}`;
          if (e.verdict !== undefined) verdict[o] = e.verdict;
        }
      }
      out.outcomes = routes;
      if (Object.keys(means).length) out.means = means;
      if (Object.keys(verdict).length) out.verdict = verdict;
    } else out[k] = v;
  }
  return out;
}

function headValueObj(name: string, kind: string, s: Obj): unknown {
  const own = CONTENT_KEY[kind];
  if (own && s[own] !== undefined) return s[own];
  if (kind === "agent") return s.description ?? `Use the \`${String(s.skill)}\` skill.`;
  if (kind === "gate") return s.description ?? `approve or reject ${name}`;
  return null;
}

function isAgentObj(s: Obj, steps: Obj, seen: Set<unknown>): boolean {
  if (typeof s.type === "string") return s.type === "agent";
  if (typeof s.like !== "string" || seen.has(s)) return false;
  seen.add(s);
  const target = steps[s.like];
  return isObj(target) && isAgentObj(target, steps, seen);
}

function headKey(kind: string, action: string | undefined, pos: number): string {
  if (kind === "agent" || kind === "check" || kind === "gate" || kind === "slices") return kind;
  if (kind === "merge") return "await-merge";
  if (kind === "git") {
    const verb = action !== undefined ? GIT_VERBS[action] : undefined;
    if (verb) return verb;
    throw new Refusal(pos, `a git step's action '${action ?? ""}' has no verb in the new wording`);
  }
  throw new Refusal(pos, `step type '${kind}' has no head key in the new wording`);
}

// ---- YAML: splice the source

interface Edit {
  start: number;
  end: number;
  text: string;
}

function translateYaml(text: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length) return text;
  const root = doc.contents;
  if (!isMap(root)) return text;
  const steps = root.get("steps", true);
  if (!isMap(steps)) return text;
  const stepPairs = steps.items.flatMap((p) => (isMap(p.value) ? [{ name: keyName(p), map: p.value as YAMLMap }] : []));
  if (!stepPairs.some((s) => isOldStepNode(s.map))) return text;
  const byName = new Map(stepPairs.map((s) => [s.name, s.map]));
  const edits: Edit[] = [];
  for (const s of stepPairs) {
    if (isOldStepNode(s.map)) edits.push(...stepEdits(text, s.name, s.map, byName));
    else if (pairOf(s.map, "like")) edits.push(...byEdit(s.map));
  }
  return apply(text, edits);
}

const keyName = (p: Pair): string => String(isScalar(p.key) ? p.key.value : p.key);
const pairOf = (m: YAMLMap, key: string): Pair<Node, Node> | undefined =>
  m.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair<Node, Node> | undefined;
const scalarValue = (m: YAMLMap, key: string): string | undefined => {
  const v = pairOf(m, key)?.value;
  return isScalar(v) && typeof v.value === "string" ? v.value : undefined;
};

function isOldStepNode(m: YAMLMap): boolean {
  if (OLD_STEP_KEYS.some((k) => pairOf(m, k))) return true;
  const outcomes = pairOf(m, "outcomes")?.value;
  return isMap(outcomes) && outcomes.items.some((e) => isMap(e.value) && EDGE_PROSE.some((k) => pairOf(e.value as YAMLMap, k)));
}

function isAgentNode(m: YAMLMap, steps: Map<string, YAMLMap>, seen: Set<YAMLMap>): boolean {
  const kind = scalarValue(m, "type");
  if (kind !== undefined) return kind === "agent";
  const like = scalarValue(m, "like");
  if (like === undefined || seen.has(m)) return false;
  seen.add(m);
  const target = steps.get(like);
  return target !== undefined && isAgentNode(target, steps, seen);
}

// Source positions of a pair in a block map: its leading comment lines, its own lines, the text of its value
const lineStart = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (text: string, pos: number) => {
  const i = text.indexOf("\n", pos);
  return i === -1 ? text.length : i;
};
const column = (text: string, pos: number) => pos - lineStart(text, pos);
const range = (n: Node): [number, number, number] => n.range as [number, number, number];
/** spanOf for an item of `m`, its leading comments taken only below the item before it */
function spanIn(text: string, m: YAMLMap, p: Pair<Node, Node>): Span {
  const i = m.items.indexOf(p);
  const before = i > 0 ? (m.items[i - 1] as Pair<Node, Node>) : undefined;
  return spanOf(text, p, before ? range(before.value ?? before.key)[1] : 0);
}

interface Span {
  /** first leading comment line, or the key's line */
  from: number;
  /** the key's line */
  keyLine: number;
  /** past the pair's last line (and its newline) */
  end: number;
  /** the value's text, a block scalar's header comment included, without a trailing newline */
  value: string;
  /** a trailing comment after a single-line value, with the spaces before it */
  tail: string;
  /** the comment lines above the key */
  lead: string;
}

// `floor` is where the pair before this one ends: a `#` line above it is that pair's value (a block scalar's text), never a comment
function spanOf(text: string, p: Pair<Node, Node>, floor = 0): Span {
  const key = range(p.key);
  const keyLine = lineStart(text, key[0]);
  const v: [number, number, number] = p.value ? range(p.value) : [key[1], key[1], key[1]];
  const valueEnd = text[v[1] - 1] === "\n" ? v[1] - 1 : v[1];
  const lastLineEnd = lineEnd(text, Math.max(valueEnd, key[1]));
  let from = keyLine;
  const indent = column(text, key[0]);
  while (from > floor) {
    const prev = lineStart(text, from - 1);
    const line = text.slice(prev, from - 1);
    if (prev < floor || !line.trim().startsWith("#") || line.length - line.trimStart().length < indent) break;
    from = prev;
  }
  const value = p.value ? text.slice(v[0], valueEnd) : "";
  const tail = text.slice(valueEnd, lastLineEnd);
  return { from, keyLine, end: Math.min(lastLineEnd + 1, text.length), value, tail: tail.trim() ? tail : "", lead: text.slice(from, keyLine) };
}

function stepEdits(text: string, name: string, m: YAMLMap, steps: Map<string, YAMLMap>): Edit[] {
  if (m.flow) throw new Refusal(range(m)[0], `step '${name}' is written as a flow map: write it as a block map to translate it`);
  const edits: Edit[] = [];
  const kind = scalarValue(m, "type");
  const typePair = pairOf(m, "type");
  const indent = " ".repeat(column(text, range(m)[0]));

  if (typePair && kind !== undefined) {
    const head = headKey(kind, scalarValue(m, "action"), range(typePair.key)[0]);
    const removed = [typePair, pairOf(m, "action"), CONTENT_KEY[kind] ? pairOf(m, CONTENT_KEY[kind] as string) : undefined].filter(
      (p): p is Pair<Node, Node> => p !== undefined,
    );
    let lead = "";
    let tail = "";
    let tailAt = -1;
    for (const p of removed) {
      const s = spanIn(text, m, p);
      edits.push({ start: s.from, end: s.end, text: "" });
      lead += s.lead;
      if (!s.tail) continue;
      if (tail) throw new Refusal(tailAt, "this comment has no line to sit on once the step's head key replaces it");
      tail = s.tail;
      tailAt = range(p.key)[0];
    }
    let line: string;
    const value = headValue(text, name, kind, m);
    if (value === null) line = `${indent}${head}:${tail}`;
    else line = `${indent}${head}: ${placeTail(value.text, tail, tailAt)}`;
    const first = spanOf(text, m.items[0] as Pair<Node, Node>);
    edits.push({ start: first.from, end: first.from, text: `${lead}${line}\n` });
  } else if (pairOf(m, "like")) {
    for (const [old, renamed] of Object.entries(COPY_RENAME)) {
      const p = pairOf(m, old);
      if (p) edits.push({ start: range(p.key)[0], end: range(p.key)[1], text: renamed });
    }
  }

  const skill = pairOf(m, "skill");
  if (skill?.value) {
    const v = range(skill.value);
    edits.push({ start: range(skill.key)[0], end: range(skill.key)[1], text: "skills" });
    edits.push({ start: v[0], end: v[1], text: `[${text.slice(v[0], v[1])}]` });
  }
  if (typePair || pairOf(m, "like")) edits.push(...byEdit(m));

  edits.push(...outcomeEdits(text, name, m, isAgentNode(m, steps, new Set()), indent));
  return edits;
}

// In a file in the old wording a step's or a copy's `agent:` names the agent that runs it
function byEdit(m: YAMLMap): Edit[] {
  const p = pairOf(m, "agent");
  return p ? [{ start: range(p.key)[0], end: range(p.key)[1], text: "by" }] : [];
}

// A comment that sat on a removed key's line goes on the head's line: after a single-line value, after a block scalar's header
function placeTail(value: string, tail: string, tailAt: number): string {
  if (!tail) return value;
  const nl = value.indexOf("\n");
  if (nl === -1) return `${value}${tail}`;
  const header = value.slice(0, nl);
  // only a block scalar's header line ends where a comment may follow; a header holding one already has no room
  if (!/^[|>]/.test(header) || header.includes("#"))
    throw new Refusal(tailAt, "this comment has no line to sit on once the step's head key replaces it");
  return `${header}${tail}${value.slice(nl)}`;
}

function headValue(text: string, name: string, kind: string, m: YAMLMap): { text: string } | null {
  const own = CONTENT_KEY[kind];
  if (!own) return null;
  const from = [own, ...(kind === "agent" || kind === "gate" ? ["description"] : [])];
  for (const k of from) {
    const p = pairOf(m, k);
    if (p?.value) return { text: spanOf(text, p).value };
  }
  if (kind === "agent") return { text: plain(`Use the \`${scalarValue(m, "skill") ?? ""}\` skill.`) };
  if (kind === "gate") return { text: plain(`approve or reject ${name}`) };
  return { text: '""' };
}

function outcomeEdits(text: string, name: string, m: YAMLMap, agent: boolean, indent: string): Edit[] {
  const outcomes = pairOf(m, "outcomes");
  if (!outcomes || !isMap(outcomes.value)) return [];
  const edits: Edit[] = [];
  const means: string[] = [];
  const verdicts: string[] = [];
  const routes = outcomes.value;
  const childCol = routes.flow ? indent.length + 2 : column(text, range(routes.items[0]?.key as Node)[0]);
  for (const e of routes.items as Pair<Node, Node>[]) {
    const outcome = keyName(e);
    const keyText = text.slice(range(e.key)[0], range(e.key)[1]);
    const edge = e.value;
    const meansNode = isMap(edge) ? pairOf(edge, "means") : undefined;
    const verdictNode = isMap(edge) ? pairOf(edge, "verdict") : undefined;
    if (isMap(edge) && (meansNode || verdictNode)) edits.push(...edgeEdits(text, e.key, edge));
    if (!agent) continue;
    if (meansNode?.value) means.push(`${keyText}: ${movedScalar(text, meansNode.value, childCol)}`);
    else if (!OVERRIDABLE.has(outcome)) means.push(`${keyText}: ${plain(`step finished with outcome ${outcome}`)}`);
    if (verdictNode?.value) verdicts.push(`${keyText}: ${movedScalar(text, verdictNode.value, childCol)}`);
  }
  for (const k of EDGE_PROSE) {
    const p = pairOf(m, k);
    if (p && (means.length || verdicts.length)) throw new Refusal(range(p.key)[0], `step '${name}' already has a ${k}: map beside meanings inside its edges`);
  }
  const child = " ".repeat(childCol);
  let block = "";
  if (means.length) block += `${indent}means:\n${means.map((l) => `${child}${l}\n`).join("")}`;
  if (verdicts.length) block += `${indent}verdict:\n${verdicts.map((l) => `${child}${l}\n`).join("")}`;
  if (block) {
    const end = spanOf(text, outcomes).end;
    edits.push({ start: end, end, text: `${text[end - 1] === "\n" ? "" : "\n"}${block}` });
  }
  return edits;
}

// A scalar that moves keeps its text; a multi-line one must still fit under its new key
function movedScalar(text: string, n: Node, keyCol: number): string {
  const r = range(n);
  const src = text.slice(r[0], text[r[1] - 1] === "\n" ? r[1] - 1 : r[1]);
  const rest = src.split("\n").slice(1);
  if (rest.some((l) => l.trim() && l.length - l.trimStart().length <= keyCol))
    throw new Refusal(r[0], "this multi-line scalar cannot move to its new key without being re-indented");
  return src;
}

// Remove `means`/`verdict` from one edge; an edge left with only `to` becomes its bare target
function edgeEdits(text: string, outcomeKey: Node, edge: YAMLMap): Edit[] {
  const items = edge.items as Pair<Node, Node>[];
  const kept = items.filter((p) => !EDGE_PROSE.includes(keyName(p)));
  const r = range(edge);
  const onlyTo = kept.length === 1 && keyName(kept[0] as Pair) === "to" && (kept[0] as Pair<Node, Node>).value;
  if (edge.flow) {
    if (text.slice(r[0], r[1]).includes("\n")) throw new Refusal(r[0], "an edge written over several lines cannot be split: write it on one line");
    if (onlyTo) {
      const v = range((kept[0] as Pair<Node, Node>).value as Node);
      return [{ start: r[0], end: r[1], text: text.slice(v[0], v[1]) }];
    }
    const out: Edit[] = [];
    items.forEach((p, i) => {
      if (!EDGE_PROSE.includes(keyName(p))) return;
      const end = range(p.value ?? p.key)[1];
      const prev = items[i - 1];
      if (prev) out.push({ start: range(prev.value ?? prev.key)[1], end, text: "" });
      else out.push({ start: range(p.key)[0], end: range(items[i + 1]?.key as Node)[0], text: "" });
    });
    return out;
  }
  if (items.some((p) => spanIn(text, edge, p).lead || spanIn(text, edge, p).tail))
    throw new Refusal(r[0], "a comment inside a block edge has no line to sit on once the edge is split");
  if (onlyTo) {
    const last = spanOf(text, items[items.length - 1] as Pair<Node, Node>);
    const colon = text.indexOf(":", range(outcomeKey)[1]);
    // a comment on the outcome key's line stays on it, after the bare target
    const comment = text.slice(colon + 1, lineEnd(text, colon)).trimEnd();
    return [{ start: colon + 1, end: last.end - 1, text: ` ${spanOf(text, kept[0] as Pair<Node, Node>).value}${comment}` }];
  }
  return items.filter((p) => EDGE_PROSE.includes(keyName(p))).map((p) => {
    const s = spanIn(text, edge, p);
    return { start: s.from, end: s.end, text: "" };
  });
}

// Edits never overlap but an insertion may sit at the start of a removal: insertions go first
function apply(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || (a.start === a.end ? 1 : 0) - (b.start === b.end ? 1 : 0));
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
