/** docs/workflows.md draws every shipped workflow as a Mermaid graph, through the real loader, and is kept up to date. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedWorkflow } from "@norn/kernel";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { freshReference, freshWorkflowsPage, ROOT, shippedWorkflows } from "../../scripts/docs-emit.ts";
import { currentReference } from "../../src/reference.ts";
import { WORKFLOWS_FILE, WORKFLOWS_MARKERS, workflowMermaid } from "../../src/workflows-page.ts";

const loaded = shippedWorkflows(SDLC_PACK);
const page = freshWorkflowsPage();
const one = (name: string): LoadedWorkflow => {
  const w = loaded[name];
  if (!w) throw new Error(`no shipped workflow ${name}`);
  return w;
};
/** The Mermaid block under a workflow's heading on the page. */
const graphOf = (name: string): string | undefined => page.match(new RegExp(`^## \`${name}\`\\n[\\s\\S]*?\`\`\`mermaid\\n([\\s\\S]*?)\`\`\``, "m"))?.[1];
const id = (step: string) => `s_${step.replace(/[^A-Za-z0-9_]/g, "_")}`;

describe("the workflows page", () => {
  test("holds one Mermaid graph per shipped workflow, each the one workflowMermaid draws", () => {
    const names = Object.keys(SDLC_PACK.workflows).map((f) => f.replace(/\.ya?ml$/, ""));
    expect(Object.keys(loaded).sort()).toEqual(names.sort());
    expect(page.match(/^```mermaid$/gm)?.length).toBe(names.length);
    for (const name of names) expect(graphOf(name), name).toBe(`${workflowMermaid(one(name))}\n`);
  });

  test("the reference links to the page", () => {
    expect(freshReference()).toContain(`(${WORKFLOWS_FILE.replace(/^docs\//, "")})`);
  });

  test("each shared part a workflow uses is a subgraph named after it, holding the steps it brought in", () => {
    const quick = one("quick");
    const g = workflowMermaid(quick);
    for (const shared of ["catch-up", "build", "base-update", "publish", "land"]) {
      const body = g.match(new RegExp(`^  subgraph u_${shared.replace(/-/g, "_")}\\["${shared}"\\]\\n([\\s\\S]*?)^  end$`, "m"))?.[1];
      expect(body, shared).toBeDefined();
      const inside = Object.entries(quick.included ?? {}).filter(([, s]) => s === shared);
      expect(inside.length, shared).toBeGreaterThan(0);
      for (const [step] of inside) expect(body).toContain(`    ${id(step)}`);
    }
    expect(workflowMermaid(one("triage"))).not.toContain("subgraph");
  });

  test("each step shows its kind and role or skill, a check is a parallelogram and a plugin step kind a double box", () => {
    const quick = one("quick");
    const g = workflowMermaid(quick);
    const implement = quick.graph.steps.implement;
    expect(implement?.agent?.role).toBe("builder");
    expect(g).toContain(`${id("implement")}["implement<br/><i>agent · builder</i><br/><small>norn-implement</small>"]`);
    expect(g).toContain(`${id("check")}[/"check<br/><i>check</i>"/]`);
    const plugin = Object.values(quick.graph.steps).find((s) => s.runner.type === "plugin");
    expect(plugin).toBeDefined();
    if (plugin) expect(g).toContain(`${id(plugin.name)}[["${plugin.name}<br/><i>${plugin.kind}</i>"]]`);
  });

  test("each counted edge is labelled with its counter and maximum, and each counter has a dashed exhausted edge to stuck", () => {
    const quick = one("quick");
    const g = workflowMermaid(quick);
    expect(quick.graph.counters["check.fail"]?.max).toBe(5);
    expect(g).toContain(`${id("check")} -->|"fail ⟳check.fail≤5"| ${id("implement")}`);
    for (const step of Object.values(quick.graph.steps))
      for (const counter of new Set(Object.values(step.routes).flatMap((r) => r.counter ?? [])))
        expect(g, `${step.name} ${counter}`).toContain(`${id(step.name)} -.->|"⟳${counter} exhausted"| STUCK`);
  });

  test("each gate is a highlighted diamond", () => {
    const quick = one("quick");
    const gates = Object.values(quick.graph.steps).filter((s) => s.kind === "gate");
    expect(gates.length).toBeGreaterThan(0);
    const g = workflowMermaid(quick);
    expect(g).toContain("classDef gate ");
    for (const gate of gates) {
      expect(g).toContain(`${id(gate.name)}{"${gate.name}<br/><i>gate</i>"}`);
      expect(g).toMatch(new RegExp(`^  class [^\\n]*\\b${id(gate.name)}\\b[^\\n]* gate$`, "m"));
    }
  });

  test("a shipped workflow changed without re-emitting docs no longer matches the page", () => {
    const quick = SDLC_PACK.workflows["quick.yaml"] ?? "";
    expect(quick).toContain("failed: { to: build, max: 3 }");
    const changed = { ...SDLC_PACK, workflows: { ...SDLC_PACK.workflows, "quick.yaml": quick.replace("failed: { to: build, max: 3 }", "failed: { to: build, max: 4 }") } };
    expect(freshWorkflowsPage(changed)).not.toBe(page);
  });

  test(`${WORKFLOWS_FILE} is up to date (bun run docs:emit)`, () => {
    const block = currentReference(readFileSync(join(ROOT, WORKFLOWS_FILE), "utf8"), WORKFLOWS_MARKERS);
    expect(block, `${WORKFLOWS_FILE} is stale: run \`bun run docs:emit\` and commit the result`).toBe(page);
  });
});
