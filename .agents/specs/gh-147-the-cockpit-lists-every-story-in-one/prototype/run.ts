/**
 * PROTOTYPE (throwaway) harness: cockpit layout variants on the same data, switched with Tab / Shift-Tab.
 *   bun run.ts [--data big|live] [--variant A]          interactive, full screen
 *   bun run.ts --snap --variant A --width 160 --height 45 [--data big] [--keys "jjj"]   one frame to stdout (no colour with --plain)
 * Actions never run anything: they show "would run: norn …".
 */
import { readFileSync } from "node:fs";
import { type CockpitModel, type Effect, parseKeys, type Variant } from "./shared.ts";
import { current } from "./variants/0-current.ts";

const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? d : (process.argv[i + 1] as string); };
const flag = (name: string) => process.argv.includes(`--${name}`);

const variants: Variant[] = [current];
for (const f of ["e", "d", "a", "b", "c"]) {
  try { const m = await import(`./variants/${f}.ts`); variants.push(m.variant); } catch (e) { if (!String(e).includes("Cannot find")) throw e; }
}
const data = arg("data", "big");
const model: CockpitModel = JSON.parse(readFileSync(new URL(data === "live" ? "./model.json" : data === "chain" ? "./chain.json" : "./big.json", import.meta.url), "utf8"));
let vi = Math.max(0, variants.findIndex((v) => v.key.toLowerCase() === arg("variant", "0").toLowerCase()));
const states = new Map<string, unknown>();
const stateOf = (v: Variant) => { if (!states.has(v.key)) states.set(v.key, v.init(model)); return states.get(v.key); };
let toast: string | null = null;

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const look = (width: number, height: number) => ({ width, height, color: !flag("plain"), now: Date.parse(model.at), clock: "15:13", toast });

function describe(e: Effect): string {
  if (e.kind !== "run") return "";
  const ef = e.action.effect;
  if (ef.kind === "verb") return `would run: norn ${ef.argv.map((a) => (a === "{input}" ? JSON.stringify(e.input ?? "") : a)).join(" ")}`;
  if (ef.kind === "link") return `would open ${ef.url}`;
  return `would go to the ${ef.place} of ${ef.story}`;
}

function step(chunk: string, l: ReturnType<typeof look>): boolean {
  for (const key of chunk.split(/(\t)/).flatMap((c) => (c === "\t" ? [{ kind: "char", char: "\t" } as const] : parseKeys(c)))) {
    if (key.kind === "char" && key.char === "\t") { vi = (vi + 1) % variants.length; toast = `variant ${variants[vi]!.key} · ${variants[vi]!.name}`; continue; }
    const v = variants[vi] as Variant;
    const { state, effect } = v.handle(stateOf(v), key, model, l);
    states.set(v.key, state);
    toast = null;
    if (effect?.kind === "quit") return false;
    if (effect) toast = describe(effect);
  }
  return true;
}

function bar(width: number): string {
  const v = variants[vi] as Variant;
  const label = ` ◀ ${v.key} (${v.name}) ▶  tab switches · ${variants.map((x) => x.key).join(" ")} · data: ${data} `;
  const pill = `\x1b[1;30;47m${label}\x1b[0m`;
  return " ".repeat(Math.max(0, Math.floor((width - label.length) / 2))) + pill;
}

if (flag("snap")) {
  const w = Number(arg("width", "160")), h = Number(arg("height", "45"));
  // keys: a string; \n is enter, \t is tab; \e is esc
  step(arg("keys", "").replace(/\\n/g, "\r").replace(/\\t/g, "\t").replace(/\\e/g, "\x1b"), look(w, h));
  const out = (variants[vi] as Variant).frame(model, stateOf(variants[vi] as Variant), look(w, h));
  console.log(flag("plain") ? strip(out) : out);
  const lines = out.split("\n");
  const wide = lines.filter((l) => strip(l).length > w).length;
  if (lines.length !== h || wide) console.error(`frame: ${lines.length} lines (want ${h}), ${wide} wider than ${w}`);
  process.exit(0);
}

const { stdin, stdout } = process;
stdin.setRawMode?.(true);
stdin.setEncoding("utf8");
stdout.write("\x1b[?1049h\x1b[?25l");
const draw = () => {
  const w = stdout.columns ?? 120, h = (stdout.rows ?? 40) - 1;
  const frame = (variants[vi] as Variant).frame(model, stateOf(variants[vi] as Variant), look(w, h));
  stdout.write(`\x1b[H\x1b[2J${frame.split("\n").slice(0, h).join("\r\n")}\r\n${bar(w)}`);
};
const quit = () => { stdout.write("\x1b[?25h\x1b[?1049l"); process.exit(0); };
stdout.on("resize", draw);
stdin.on("data", (c: string) => { if (!step(c, look(stdout.columns ?? 120, (stdout.rows ?? 40) - 1))) quit(); draw(); });
draw();

