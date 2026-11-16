/**
 * `norn init` copies the bundled shared files next to the workflows, keeping a repo's own, so the
 * bundled workflows that `use:` them load in a new repo; the detected test command reaches the
 * shared file that holds the test check.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflows, SHARED_DIR, workflowsDir } from "@norn/store";
import { createHarness } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const BUNDLED_SHARED = join(import.meta.dir, "..", "..", "assets", "workflows", SHARED_DIR);
const shared = readdirSync(BUNDLED_SHARED).sort();

type Init = { workflows: { created: string[]; kept: string[] }; test_command: { command: string; set_in: string[] } | null };

describe("norn init copies the bundled shared files", () => {
  test("a new repo gets every shared file, reported under created, and every bundled workflow loads", async () => {
    const h = await createHarness();
    try {
      const r = await h.norn("init", "--json");
      expect(r.exit).toBe(0);
      const v = r.value as Init;
      expect(v.workflows.created.filter((f) => f.startsWith(`${SHARED_DIR}/`))).toEqual(shared.map((f) => `${SHARED_DIR}/${f}`));
      for (const f of shared) expect(readFileSync(join(workflowsDir(h.root), SHARED_DIR, f), "utf8")).toBe(readFileSync(join(BUNDLED_SHARED, f), "utf8"));
      const listing = loadWorkflows(h.root);
      expect(listing.errors).toEqual([]);
      expect(Object.keys(listing.workflows).sort()).toEqual(["quick", "refinement", "reproduce", "slice", "story", "triage"]);
    } finally {
      h.cleanup();
    }
  });

  test("a shared file the repo already has is kept as it is, reported under kept", async () => {
    const h = await createHarness();
    try {
      const ours = `# ours\n${readFileSync(join(BUNDLED_SHARED, "ship.yaml"), "utf8")}`;
      h.write(join(workflowsDir(h.root), SHARED_DIR, "ship.yaml"), ours);
      const v = (await h.norn("init", "--json")).value as Init;
      expect(v.workflows.kept).toEqual([`${SHARED_DIR}/ship.yaml`]);
      expect(v.workflows.created).not.toContain(`${SHARED_DIR}/ship.yaml`);
      expect(v.workflows.created).toContain(`${SHARED_DIR}/sync.yaml`);
      expect(readFileSync(join(workflowsDir(h.root), SHARED_DIR, "ship.yaml"), "utf8")).toBe(ours);
      expect(loadWorkflows(h.root).errors).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  test("the detected test command is written into the shared file with the test check, and the loaded test steps run it", async () => {
    const h = await createHarness();
    try {
      writeFileSync(join(h.root, "package.json"), JSON.stringify({ name: "app", scripts: { test: "vitest run" } }));
      writeFileSync(join(h.root, "package-lock.json"), "{}");
      const v = (await h.norn("init", "--json")).value as Init;
      expect(v.test_command).toMatchObject({ command: "npm ci && npm test" });
      expect(v.test_command?.set_in).toContain(`${SHARED_DIR}/base-update.yaml`);
      expect(readFileSync(join(workflowsDir(h.root), SHARED_DIR, "base-update.yaml"), "utf8")).toContain('run: "npm ci && npm test"');
      const listing = loadWorkflows(h.root);
      expect(listing.errors).toEqual([]);
      for (const wf of ["quick", "story"])
        for (const step of ["test", "test-merge", "test-resolution"])
          expect({ wf, step, run: (listing.workflows[wf]?.workflow.steps[step] as { run?: string } | undefined)?.run }).toEqual({ wf, step, run: "npm ci && npm test" });
    } finally {
      h.cleanup();
    }
  });
});
