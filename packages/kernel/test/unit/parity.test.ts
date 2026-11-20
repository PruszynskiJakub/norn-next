import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SIGNAL_KINDS } from "@norn/schema";
import { ACTION_KINDS, RECEIPT_KINDS, RULE_IDS } from "../../src/index.ts";

const KERNEL = join(import.meta.dir, "..", "..");
const PARITY = readFileSync(join(KERNEL, "test", "parity.md"), "utf8");
/** Every id parity.md names in a code span. */
const NAMED = new Set([...PARITY.matchAll(/`([^`\s]+)`/g)].map((m) => m[1] as string));
/** A table row's cells; a `|` inside a code span does not occur in parity.md. */
const cells = (row: string): string[] => row.split("|").slice(1, -1).map((c) => c.trim());
/** The ids in the New rule column (the third) of parity.md's four-column rule tables, a dropped rule's reason left out. */
const NEW_COLUMN = new Set(
  PARITY.split("\n")
    .filter((l) => l.startsWith("|") && cells(l).length === 4)
    .map((l) => cells(l)[2] as string)
    .filter((c) => !c.startsWith("dropped") && !c.startsWith("plugin step kind"))
    .flatMap((c) => [...c.matchAll(/`([^`\s]+)`/g)].map((m) => m[1] as string)),
);
const PROSE_IDS = new Set([...(PARITY.split("New rule ids:")[1]?.split("\n\n")[0] ?? "").matchAll(/`([^`\s]+)`/g)].map((m) => m[1] as string));

describe("parity.md", () => {
  test("names every rule id the kernel's decide can emit as a new rule", () => {
    expect(RULE_IDS.filter((r) => !NEW_COLUMN.has(r) && !PROSE_IDS.has(r))).toEqual([]);
  });

  test("names every kernel action kind", () => {
    expect(ACTION_KINDS.filter((k) => !NAMED.has(k))).toEqual([]);
  });

  test("names no new rule id the kernel does not emit", () => {
    const ruleLike = /^(agent|check|claim|gate|intake|mailbox|receipts|round|slice|slices|step|store|story|unit)\.[a-z_.]+$/;
    const extra = [...NEW_COLUMN, ...PROSE_IDS].filter((id) => ruleLike.test(id) && !RULE_IDS.includes(id) && !RECEIPT_KINDS.includes(id as never));
    expect(extra).toEqual([]);
  });

  // the old engine is read as text while it exists beside the kernel; the cutover removes it and this check with it
  const OLD = join(KERNEL, "..", "core");
  test.skipIf(!existsSync(OLD))("names every rule id the old golden corpus and rule cases fire, and every old action kind", () => {
    const golden = join(OLD, "test", "golden");
    const old = new Set<string>();
    for (const f of readdirSync(golden).filter((n) => n.endsWith(".json"))) for (const d of JSON.parse(readFileSync(join(golden, f), "utf8")).decisions) old.add(d.rule);
    for (const m of readFileSync(join(OLD, "test", "rule-cases.ts"), "utf8").matchAll(/rule: "([^"]+)"/g)) old.add(m[1] as string);
    expect([...old].filter((r) => !NAMED.has(r)).sort()).toEqual([]);
    const actions = [...readFileSync(join(OLD, "src", "actions.ts"), "utf8").matchAll(/^\s+kind: "([a-z_]+)";$/gm)].map((m) => m[1] as string);
    expect(actions.length).toBeGreaterThan(20);
    expect(actions.filter((k) => !NAMED.has(k))).toEqual([]);
  });
});

describe("RULE_IDS", () => {
  /** Quoted dotted names in decide's sources that are not rule ids: receipt kinds, signal kinds, and the bases quiet rules suffix. */
  const NOT_RULES = new Set<string>([...RECEIPT_KINDS, ...SIGNAL_KINDS, "agent.silent", "agent.turn_ended", "agent.limited"]);

  test("lists every rule id written as a literal in decide's sources", () => {
    const dir = join(KERNEL, "src", "decide");
    const literals = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "rules.ts")
      .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)].map((m) => m[1] as string));
    expect([...new Set(literals)].filter((l) => !NOT_RULES.has(l) && !RULE_IDS.includes(l)).sort()).toEqual([]);
  });

  test("lists every id a rule builds from a template in decide's sources", () => {
    const dir = join(KERNEL, "src", "decide");
    const templates = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "rules.ts")
      .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/`(\$\{base\}|\$\{prefix\}|unit\.ended)\.([a-z_${}.]+)`/g)].map((m) => `${m[1]}.${m[2]}`));
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      const expansions = t.startsWith("${base}")
        ? ["agent.silent", "agent.turn_ended", "agent.limited"].map((b) => t.replace("${base}", b))
        : t.startsWith("${prefix}")
          ? ["gate", "step", "await"].map((p) => t.replace("${prefix}", p))
          : ["unit.ended.done", "unit.ended.stuck"];
      expect(expansions.filter((e) => !RULE_IDS.includes(e))).toEqual([]);
    }
  });
});
