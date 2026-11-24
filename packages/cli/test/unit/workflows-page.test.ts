/** docs/workflows.md draws every shipped workflow as Mermaid graphs, through the real loader, and is kept up to date. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedWorkflow } from "@norn/kernel";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { freshReference, freshWorkflowsPage, ROOT, shippedWorkflows } from "../../scripts/docs-emit.ts";
import { currentReference } from "../../src/reference.ts";
import { groupMermaid, ROW_NODES, sharedParts, WORKFLOWS_FILE, WORKFLOWS_MARKERS, workflowMermaid, workflowRows } from "../../src/workflows-page.ts";

const loaded = shippedWorkflows(SDLC_PACK);
const page = freshWorkflowsPage();
const one = (name: string): LoadedWorkflow => {
  const w = loaded[name];
  if (!w) throw new Error(`no shipped workflow ${name}`);
  return w;
};
const id = (step: string) => `s_${step.replace(/[^A-Za-z0-9_]/g, "_")}`;
const gid = (shared: string) => `u_${shared.replace(/[^A-Za-z0-9_]/g, "_")}`;
/** Every node a graph declares: its id and its label's lines, markup stripped. */
function nodes(g: string): Array<{ id: string; lines: string[] }> {
  return [...g.matchAll(/^\s+([A-Za-z_][\w]*)[[({/]+"(.*?)"[\])}/]+$/gm)].map((m) => ({
    id: m[1] as string,
    lines: (m[2] as string).split("<br/>").map((l) => l.replace(/<[^>]+>/g, "").replace(/#quot;/g, '"')),
  }));
}
const SHARED_NAMES = new Set(["catch-up", "build", "base-update", "publish", "land", "diagnose"]);
/**
 * Every edge, read the way it goes: a short loop-back is written from its target, arrowless, labelled
 * `← outcome`; a long one ends at a `↩ name` stub, read here as an edge to that name.
 */
function edges(g: string) {
  const stubs = new Map([...g.matchAll(/^\s+([bf]_\w+)\(\["(↩|→) (.*?)"\]\)$/gm)].map((m) => [m[1], { kind: m[2] === "↩" ? "back" : "on", to: SHARED_NAMES.has(m[3] as string) ? gid(m[3] as string) : id(m[3] as string) }]));
  return [...g.matchAll(/^\s+(\w+) (-->|-\.->|-\.-)(?:\|"(.*?)"\|)? (\w+)$/gm)].map((m) => {
    if (m[2] === "-.-") return { from: m[4], kind: "back", label: (m[3] ?? "").replace(/^← /, ""), to: m[1] };
    const stub = stubs.get(m[4] as string);
    if (stub) return { from: m[1], kind: stub.kind, label: m[3] ?? null, to: stub.to };
    return { from: m[1], kind: "forward", label: m[3] ?? null, to: m[4] };
  });
}
const SHARED = ["catch-up", "build", "base-update", "publish", "land"];

describe("the workflows page", () => {
  test("holds each shipped workflow's main graph, in rows when its path is long, then one small graph per shared part it uses", () => {
    const names = Object.keys(SDLC_PACK.workflows).map((f) => f.replace(/\.ya?ml$/, ""));
    expect(Object.keys(loaded).sort()).toEqual(names.sort());
    const graphs = [...page.matchAll(/^```mermaid\n([\s\S]*?)```$/gm)].map((m) => m[1]);
    const want = names.sort().flatMap((n) => [...workflowRows(one(n)), ...sharedParts(one(n)).map((s) => groupMermaid(one(n), s))]).map((g) => `${g}\n`);
    expect(graphs).toEqual(want);
    expect(sharedParts(one("quick"))).toEqual(SHARED);
    expect(page).toContain("### `quick` › `build`");
  });

  test("the reference links to the page", () => {
    expect(freshReference()).toContain(`(${WORKFLOWS_FILE.replace(/^docs\//, "")})`);
  });

  test("a main graph reads left to right along the main path, each shared part one node, none of its steps drawn", () => {
    const quick = one("quick");
    const g = workflowMermaid(quick);
    expect(g.split("\n")[1]).toBe("flowchart LR");
    expect(g).not.toContain("subgraph");
    const ids = nodes(g).filter((n) => !/^[bf]_/.test(n.id)).map((n) => n.id);
    expect(ids).toEqual([...SHARED.map(gid), "DONE"]);
    const forward = edges(g).filter((e) => e.kind === "forward");
    expect(forward.map((e) => `${e.from}>${e.to}`)).toEqual(["u_catch_up>u_build", "u_build>u_base_update", "u_base_update>u_publish", "u_publish>u_land", "u_land>DONE"]);
    expect(nodes(workflowMermaid(one("triage"))).map((n) => n.id)).toEqual([id("explore"), "DONE"]);
  });

  test("a long main path wraps into rows, each starting where the one before ends; a short one is one row", () => {
    expect(workflowRows(one("quick"))).toEqual([workflowMermaid(one("quick"))]);
    const story = workflowRows(one("story"));
    expect(story.length).toBe(2);
    const [first, second] = story.map((g) => nodes(g).filter((n) => !/^[bf]_/.test(n.id)).map((n) => n.id));
    // cut where the rows come out even: the second row also draws human-qa and most loop-back stubs
    expect(first).toEqual([gid("catch-up"), id("slice"), id("approve-slices"), id("slices"), gid("base-update"), id("qa"), gid("build")]);
    expect(second?.[0]).toBe(id("qa"));
    expect(second).toContain(id("human-qa"));
    expect(second?.at(-1)).toBe("DONE");
    for (const g of story) expect(edges(g).filter((e) => e.kind === "forward" && !/^[bf]_/.test(e.to ?? "")).length).toBeLessThanOrEqual(ROW_NODES + 2);
    // the first row ends at qa: its ways on are drawn in the second
    expect(story[0]).not.toMatch(/^  s_qa -->/m);
    expect(story[1]).toMatch(/^  s_qa -->/m);
    expect(story[1]).toContain(`(["↩ build"])`);
    expect(story[0]).toContain(`  u_base_update -.-> f_u_base_update_u_publish`);
  });

  test("a loop-back is a short dotted line labelled with its outcome, pointing back", () => {
    // one step back is a dotted line; a longer loop ends at a stub beside its source
    expect(workflowMermaid(one("quick"))).toContain(`u_build -.-|"← fail"| u_base_update`);
    expect(workflowMermaid(one("quick"))).toContain(`u_publish -.->|"fail"| b_u_publish_u_build`);
    const quick = one("quick");
    const back = edges(workflowMermaid(quick)).filter((e) => e.kind === "back");
    expect(back).toContainEqual({ from: "u_publish", kind: "back", label: "fail", to: "u_build" });
    expect(back).toContainEqual({ from: "u_land", kind: "back", label: "reject", to: "u_build" });
    for (const e of back) expect(e.label?.length ?? 0, `${e.from}>${e.to}`).toBeLessThanOrEqual(18);
    expect(edges(groupMermaid(quick, "build"))).toContainEqual({ from: id("check"), kind: "back", label: "fail", to: id("implement") });
  });

  test("each counter's maximum is a badge on its step, and stuck is drawn nowhere", () => {
    const quick = one("quick");
    expect(quick.graph.counters["check.fail"]?.max).toBe(5);
    const check = nodes(groupMermaid(quick, "build")).find((n) => n.id === id("check"));
    expect(check?.lines).toContain("⟳ fail ≤5");
    const review = nodes(groupMermaid(quick, "build")).find((n) => n.id === id("review"));
    expect(review?.lines).toContain("⟳ changes_requested ≤3");
    for (const name of Object.keys(loaded)) {
      const w = one(name);
      for (const g of [workflowMermaid(w), ...workflowRows(w), ...sharedParts(w).map((s) => groupMermaid(w, s))]) {
        expect(g, name).not.toContain("STUCK");
        expect(g, name).not.toContain("exhausted");
      }
    }
    const slice = nodes(workflowMermaid(one("story"))).find((n) => n.id === id("slice"));
    expect(slice?.lines).toContain("replan → stuck");
  });

  test("a shared part's own graph holds its steps and the places it leads on to; one behind it is a loop-back stub", () => {
    const update = groupMermaid(one("quick"), "base-update");
    expect(nodes(update).map((n) => n.id)).not.toContain(gid("build"));
    expect(edges(update)).toContainEqual({ from: id("test"), kind: "back", label: "fail", to: gid("build") });
    expect(nodes(groupMermaid(one("story"), "base-update")).find((n) => n.id === id("qa"))?.lines).toEqual(["qa"]);
    const quick = one("quick");
    const g = groupMermaid(quick, "build");
    expect(g.split("\n")[1]).toBe("flowchart LR");
    expect(nodes(g).filter((n) => !/^[bf]_/.test(n.id)).map((n) => n.id)).toEqual([id("implement"), id("check"), id("review"), gid("base-update")]);
    expect(edges(g)).toContainEqual({ from: id("review"), kind: "forward", label: null, to: gid("base-update") });
    expect(edges(g)).toContainEqual({ from: id("review"), kind: "back", label: "changes_requested", to: id("implement") });
  });

  test("a gate is a highlighted hexagon, a check a parallelogram, a plugin step kind a double box, an agent step names its role", () => {
    const quick = one("quick");
    const land = groupMermaid(quick, "land");
    expect(land).toContain(`${id("ready")}{{"ready<br/><small>gate</small>`);
    expect(land).toMatch(new RegExp(`^  class [^\\n]*\\b${id("ready")}\\b[^\\n]* gate$`, "m"));
    expect(land).toContain("classDef gate ");
    const build = groupMermaid(quick, "build");
    expect(groupMermaid(quick, "base-update")).toContain(`${id("test-merge")}[/"test-merge<br/><small>check</small>`);
    // a kind named like its step says nothing twice
    expect(build).toContain(`${id("check")}[/"check<br/><small>⟳ fail ≤5</small>"/]`);
    expect(build).toContain(`${id("implement")}["implement<br/><small>agent · builder</small>`);
    expect(groupMermaid(quick, "publish")).toContain(`${id("checks")}[["checks<br/><small>await-checks</small>`);
    expect(groupMermaid(quick, "publish")).toContain(`${id("open-pr")}[["open-pr"]]`);
    const story = workflowMermaid(one("story"));
    expect(story).toContain(`${id("approve-slices")}{{"approve-slices`);
  });

  test("expanded, one shared part shows its steps inside the main graph, and the live step is lit", () => {
    const quick = one("quick");
    const g = workflowMermaid(quick, { expand: "build", live: "check" });
    const body = g.match(/^  subgraph u_build\["build"\]\n([\s\S]*?)^  end$/m)?.[1] ?? "";
    for (const step of ["implement", "check", "review"]) expect(body).toContain(`    ${id(step)}`);
    expect(nodes(g).filter((n) => !/^[bf]_/.test(n.id)).map((n) => n.id)).toEqual([gid("catch-up"), gid("base-update"), gid("publish"), gid("land"), "DONE", id("implement"), id("check"), id("review")]);
    expect(g).toContain(`class ${id("check")} live`);
    expect(workflowMermaid(quick)).not.toContain(" live");
  });

  test("labels stay short enough to read at a docs page's width: at most 12 nodes a graph, 26 characters a line", () => {
    for (const name of Object.keys(loaded)) {
      const w = one(name);
      for (const g of [...workflowRows(w), ...sharedParts(w).map((s) => groupMermaid(w, s))]) {
        const ns = nodes(g).filter((n) => !/^[bf]_/.test(n.id));
        expect(ns.length, name).toBeLessThanOrEqual(12);
        for (const n of ns) for (const l of n.lines) expect(l.length, `${name} ${n.id}: ${l}`).toBeLessThanOrEqual(26);
      }
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
