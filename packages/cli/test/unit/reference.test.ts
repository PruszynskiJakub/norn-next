/** docs/reference.md's generated block is rendered from the cli and kept up to date. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { DEFAULT_KERNEL_CONFIG } from "@norn/kernel";
import { collectSignals, collectStepKinds, loadPackWorkflows, signalDeclarations } from "@norn/runtime";
import { ExitCode } from "@norn/schema";
import { parse } from "yaml";
import { freshContributing, freshReference, repoWorkflowTexts, ROOT } from "../../scripts/docs-emit.ts";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";
import { packCatalog } from "../../src/catalog.ts";
import { CONFIG_DEFAULTS, KernelKnobs } from "../../src/config/schema.ts";
import { tableCell } from "../../src/output.ts";
import { BUNDLED_PLUGINS } from "../../src/plugins/bundled.ts";
import { CONTRIBUTING_FILE, CONTRIBUTING_MARKERS, configKeys, currentReference, durationText, KEY_DEFAULTS, REFERENCE_END, REFERENCE_FILE, REFERENCE_MARKERS, REFERENCE_START, renderReference, replaceReference } from "../../src/reference.ts";

const fresh = freshReference();

describe("reference render", () => {
  test("every command and every noun verb has a heading with its usage, every option is listed", () => {
    for (const c of [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)]) {
      expect(fresh).toContain(`##### \`norn ${c.name}\`\n`);
      expect(fresh).toContain(c.usage);
      for (const k of Object.keys(c.options ?? {})) expect(fresh).toMatch(new RegExp(`^- \`[^\`\n]*--${k}(?![\\w-])`, "m"));
    }
    for (const n of NOUNS) expect(fresh).toContain(`##### \`norn ${n.name}\` (noun)`);
  });

  test("a person-only command says so under its heading, and no other command does", () => {
    const line = "A person's command: refused in an agent's session (`person_only`).";
    for (const c of [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)]) {
      const marked = fresh.includes(`##### \`norn ${c.name}\`\n\n${c.summary}\n\n${line}\n`);
      expect(marked, c.name).toBe(c.personOnly === true);
    }
  });

  test("every config key appears with its type, and the defaults come from the cli, the kernel and the runtime", () => {
    const { rows } = configKeys();
    for (const r of rows) expect(fresh).toMatch(new RegExp(`^\\| \`${r.key.replace(/[.<>]/g, "\\$&")}\` \\| `, "m"));
    expect(fresh).toContain('| `kernel.mode` | `"manual"` or `"auto"` | `"manual"` |');
    expect(fresh).toContain('| `vcs.use` | string | `"git"` |');
    expect(fresh).toContain('| `packs` | list of strings (one) | `["sdlc"]` |');
    expect(fresh).toContain('| `kernel.silent_after` | duration | `"15m"` |');
    expect(fresh).toContain('| `kernel.deadline` | duration or `"none"` | `"1h"` |');
    expect(fresh).toContain("| `executors.<name>.harness` | string | none |");
    expect(fresh).toContain("| `executor` | string | derived: the only executor |");
    expect(fresh).toMatch(/^Beside `use`, `tracker`, `forge`, `store`, `vcs`/m);
  });

  test("the evidence.publish key says what it publishes, who sees it and how to turn it off", () => {
    expect(fresh).toContain("| `evidence.publish` | boolean | `true` |");
    expect(fresh).toMatch(/^`evidence\.publish` keeps an agent QA report's evidence on `refs\/norn\/evidence\/<story>`.*as visible as the repo.*`false` keeps nothing.*forge-none never publishes.*\(#evidence\)/m);
  });

  test("the kernel.mode key says why init writes auto with the headless runner while the default is manual, and how to start in manual", () => {
    expect(fresh).toMatch(/^`kernel\.mode` is `"manual"` when no file sets it.*`norn init` writes `"auto"` with the headless runner.*`"manual"` with Herdr.*costs? money.*`norn config set kernel\.mode manual`/m);
  });

  test("every kernel knob has a default, and every default names a key the schema has", () => {
    const keys = new Set(configKeys().rows.map((r) => r.key));
    for (const k of Object.keys(KernelKnobs.properties).filter((k) => k !== "counters")) expect(KEY_DEFAULTS, k).toHaveProperty([`kernel.${k}`]);
    expect(Object.keys(KEY_DEFAULTS).filter((k) => !keys.has(k))).toEqual([]);
  });

  test("a duration is spelled in the largest unit that divides it", () => {
    expect([durationText(900_000), durationText(3_600_000), durationText(400_000), durationText(1_500), durationText(604_800_000)]).toEqual(["15m", "1h", "400s", "1500ms", "7d"]);
  });

  test("the commands a harness runs, its hooks and the lab's stand-in agent, are listed apart from a person's and an agent's", () => {
    const section = fresh.slice(fresh.indexOf("#### Called by a harness, not by hand"));
    const end = section.indexOf("\n#### ", 1);
    const headings = [...(end < 0 ? section : section.slice(0, end)).matchAll(/^##### `norn ([a-z-]+)`/gm)].map((m) => m[1]);
    expect(headings).toEqual(["hook", "lab-agent"]);
  });

  test("every exit code with its meaning", () => {
    for (const [k, v] of Object.entries(ExitCode)) expect(fresh).toMatch(new RegExp(`^\\| ${v} \\| \`${k}\` \\| \\S`, "m"));
  });
});

const oneLine = (s: unknown): string => String(s ?? "").trim().replace(/\s+/g, " ");
const PACK_DOCS = Object.values(SDLC_PACK.workflows).map((text) => parse(text) as { name: string; when: string; description: string; start: string });
const LOADED = (() => {
  const signals = collectSignals(BUNDLED_PLUGINS);
  const kinds = collectStepKinds(BUNDLED_PLUGINS);
  if (!signals.ok || !kinds.ok) throw new Error("the bundled plugins do not resolve");
  const r = loadPackWorkflows(SDLC_PACK, kinds.value, DEFAULT_KERNEL_CONFIG, signalDeclarations(signals.value));
  if (!r.ok) throw new Error(r.failure.message);
  return r.value;
})();
const skillDescription = (files: Record<string, string>): { description: string; personOnly: boolean } => {
  const fm = parse((files["SKILL.md"] ?? "").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "") as { description: string; "disable-model-invocation"?: boolean };
  return { description: oneLine(fm.description), personOnly: fm["disable-model-invocation"] === true };
};
/** The text under one catalog heading, up to the next heading of its level or above. */
function catalogSection(doc: string, heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const rest = doc.slice(start + heading.length + 2);
  const next = rest.search(/^#{1,4} /m);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("the workflow and skill catalog", () => {
  const catalog = catalogSection(fresh, "### Workflow catalog") + catalogSection(fresh, "### Skills");
  const workflows = (name: string) => catalogSection(fresh, `#### \`${name}\``);

  test("every pack workflow has its name, when text, description, start step and norn:wf label", () => {
    expect(PACK_DOCS.length).toBeGreaterThan(0);
    expect(catalog).not.toBe("");
    for (const doc of PACK_DOCS) {
      const section = workflows(doc.name);
      expect(section, doc.name).toContain(`**When:** ${oneLine(doc.when)}`);
      expect(section, doc.name).toContain(oneLine(doc.description));
      const load = LOADED[doc.name];
      expect(section, doc.name).toContain(`starts at \`${load?.ok ? load.workflow.graph.start : "?"}\``);
      if (doc.name === DEFAULT_KERNEL_CONFIG.sliceWorkflow) expect(section).toContain("No label: a story's `slices` step runs it on each slice");
      else expect(section, doc.name).toContain(`Label \`${DEFAULT_KERNEL_CONFIG.intakeWorkflowLabelPrefix}${doc.name}\``);
    }
  });

  test("the when text names each workflow's next rounds, so the catalog says what follows it", () => {
    expect(workflows("triage")).toContain("--workflow refinement|quick|reproduce|fix");
    expect(workflows("refinement")).toContain("--workflow story|quick");
  });

  test("every pack skill is listed with its Use when clause, and only the person-only ones are marked", () => {
    expect(Object.keys(SDLC_PACK.skills).length).toBeGreaterThan(0);
    for (const [name, files] of Object.entries(SDLC_PACK.skills)) {
      const { description, personOnly } = skillDescription(files);
      const clause = description.slice(description.search(/\bUse (when|for)\b/));
      const row = `| \`${name}\`${personOnly ? " (a person's)" : ""} | ${tableCell(clause)} |`;
      expect(catalog, name).toContain(row);
    }
    expect(catalog).toContain("| `norn-fsd` (a person's) |");
    expect(catalog).not.toContain("| `norn-implement` (a person's) |");
  });

  test("a start that names a shared group is shown as the step the workflow enters", () => {
    expect((PACK_DOCS.find((d) => d.name === "quick") as { start: string }).start).toBe("catch-up");
    expect(workflows("quick")).toContain("starts at `sync`");
  });

  test("each workflow lists its steps, the shared files' steps included, with the skills each step uses", () => {
    for (const [name, load] of Object.entries(LOADED)) {
      if (!load.ok) throw new Error(`${name} does not load`);
      const section = workflows(name);
      for (const step of Object.values(load.workflow.graph.steps)) {
        const skills = step.agent?.skills ?? [];
        expect(section, `${name}.${step.name}`).toMatch(new RegExp(`^\\| \`${step.name}\` \\| [^|]+ \\| ${skills.length ? skills.map((s) => `\`${s}\``).join(", ") : "—"} \\|$`, "m"));
      }
    }
    expect(workflows("quick")).toMatch(/^\| `implement` \| agent \(builder\) \| `norn-implement` \|$/m);
  });

  test("the stale check fails when a pack workflow or skill changes without re-emitting docs", () => {
    const pack = CONFIG_DEFAULTS.packs?.[0] ?? "sdlc";
    const render = (p: typeof SDLC_PACK) => renderReference({ commands: COMMANDS, nouns: NOUNS, pack, catalog: packCatalog(p, BUNDLED_PLUGINS) });
    expect(render(SDLC_PACK)).toBe(fresh);
    const quick = (SDLC_PACK.workflows["quick.yaml"] as string).replace(/^when: >-\n/m, "when: >-\n  A changed line.\n");
    expect(render({ ...SDLC_PACK, workflows: { ...SDLC_PACK.workflows, "quick.yaml": quick } })).not.toBe(fresh);
    const tdd = SDLC_PACK.skills["norn-tdd"] as Record<string, string>;
    const skill = { ...tdd, "SKILL.md": (tdd["SKILL.md"] as string).replace("Use for TDD", "Use for test-driven work") };
    expect(render({ ...SDLC_PACK, skills: { ...SDLC_PACK.skills, "norn-tdd": skill } })).not.toBe(fresh);
  });
});

describe("CONTRIBUTING.md's workflow table", () => {
  const block = freshContributing();
  const repo = repoWorkflowTexts();

  test("is this repo's workflows, the pack overlaid with .agents/workflows, as Label, Workflow, When rows", () => {
    expect(block.startsWith(CONTRIBUTING_MARKERS.start) && block.endsWith(CONTRIBUTING_MARKERS.end)).toBe(true);
    expect(block).toContain("| Label | Workflow | When |");
    const names = new Set([...Object.keys(SDLC_PACK.workflows), ...Object.keys(repo.workflows)].map((f) => f.replace(/\.ya?ml$/, "")));
    expect(names.has("release")).toBe(true);
    for (const name of names) {
      const text = repo.workflows[`${name}.yaml`] ?? SDLC_PACK.workflows[`${name}.yaml`];
      const when = tableCell(oneLine((parse(text as string) as { when: string }).when));
      const label = name === DEFAULT_KERNEL_CONFIG.sliceWorkflow ? "—" : `\`${DEFAULT_KERNEL_CONFIG.intakeWorkflowLabelPrefix}${name}\``;
      expect(block, name).toContain(`| ${label} | ${name} | ${when} |`);
    }
  });

  test(`${CONTRIBUTING_FILE} is up to date (bun run docs:emit)`, () => {
    const current = currentReference(readFileSync(join(ROOT, CONTRIBUTING_FILE), "utf8"), CONTRIBUTING_MARKERS);
    expect(current, `${CONTRIBUTING_FILE} is stale: run \`bun run docs:emit\` and commit the result`).toBe(block);
  });
});

describe("the generated block in the file", () => {
  test("replaceReference keeps the prose around the markers and replaces only the block", () => {
    const doc = `# Reference\n\nprose before\n\n${REFERENCE_START}\nold\n${REFERENCE_END}\n\nprose after\n`;
    const out = replaceReference(doc, `${REFERENCE_START}\nnew\n${REFERENCE_END}`, REFERENCE_MARKERS);
    expect(out).toBe(`# Reference\n\nprose before\n\n${REFERENCE_START}\nnew\n${REFERENCE_END}\n\nprose after\n`);
    expect(() => replaceReference("# no markers", "x", REFERENCE_MARKERS)).toThrow("no generated block");
  });

  test("the block helpers take a marker pair, so one file holds two generated blocks, each kept apart", () => {
    const other = { start: "<!-- other:start -->", end: "<!-- other:end -->" };
    const doc = `${REFERENCE_START}\nref\n${REFERENCE_END}\nprose\n${other.start}\nold\n${other.end}\n`;
    const out = replaceReference(doc, `${other.start}\nnew\n${other.end}`, other);
    expect(out).toBe(`${REFERENCE_START}\nref\n${REFERENCE_END}\nprose\n${other.start}\nnew\n${other.end}\n`);
    expect(currentReference(out, other)).toBe(`${other.start}\nnew\n${other.end}`);
    expect(currentReference(out, REFERENCE_MARKERS)).toBe(`${REFERENCE_START}\nref\n${REFERENCE_END}`);
    expect(currentReference("# none", other)).toBeUndefined();
    expect(() => replaceReference("# none", "x", other)).toThrow(other.start);
  });

  test(`${REFERENCE_FILE} is up to date (bun run docs:emit)`, () => {
    const block = currentReference(readFileSync(join(ROOT, REFERENCE_FILE), "utf8"), REFERENCE_MARKERS);
    expect(block, `${REFERENCE_FILE} is stale: run \`bun run docs:emit\` and commit the result`).toBe(fresh);
  });
});
