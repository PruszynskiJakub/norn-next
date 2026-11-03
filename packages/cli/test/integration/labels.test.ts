/**
 * gh-67 GR10 at the CLI seam: `norn init` and `norn upgrade` create the labels norn uses on the
 * remote (the harness's FakeRemote), never edit or delete one, and never fail for the remote's sake;
 * `norn doctor` warns about missing and unused ones and `doctor --repo` never looks (A7).
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workflowsDir } from "@norn/store";
import { createHarness, type Harness, runChecked, sh } from "../../../../test/support/harness.ts";
import type { LabelsReport } from "../../src/runtime/labels.ts";

setDefaultTimeout(60_000);

const SHIPPED = ["quick", "refinement", "reproduce", "slice", "story", "triage"].map((n) => `norn:wf:${n}`);
const TRIAGE = [
  "norn:kind:bug",
  "norn:kind:feature",
  "norn:kind:security",
  "norn:kind:chore",
  "norn:kind:docs",
  "norn:risk:low",
  "norn:risk:medium",
  "norn:risk:high",
  "norn:priority:low",
  "norn:priority:medium",
  "norn:priority:high",
  "norn:priority:extreme",
];
const ALL = ["norn", ...SHIPPED, ...TRIAGE];

/** init prints its labels row as `  labels          …`, upgrade as `labels: …`: read both alike */
const text = (r: { stdout: string }) => r.stdout.replace(/^ {2}labels {10}/m, "labels: ");

const portError = (code: string, message: string) => Object.assign(new Error(message), { code, retryable: false });

async function inited(): Promise<Harness> {
  const h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  sh(h.root, ["add", "-A"]);
  sh(h.root, ["commit", "-q", "-m", "Set up norn"]);
  return h;
}

/** A copy of the shipped `quick` workflow under another name. */
function addWorkflow(h: Harness, name: string, text?: string) {
  const quick = readFileSync(join(workflowsDir(h.root), "quick.yaml"), "utf8");
  h.write(join(workflowsDir(h.root), `${name}.yaml`), text ?? quick.replace(/^name: quick$/m, `name: ${name}`));
}

describe("norn init creates the labels norn uses (GR10)", () => {
  test("B1, B6, B9, B15: every label is created with the norn colour and a description, listed in the report and --json", async () => {
    const h = await createHarness();
    try {
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(h.remote.labels.map((l) => l.name)).toEqual(ALL);
      for (const l of h.remote.labels) {
        expect(l.color).toBe("5319E7");
        expect(l.description.length).toBeGreaterThan(0);
      }
      expect(h.remote.labels.find((l) => l.name === "norn")?.description).toBe("norn takes in issues assigned to you with this label");
      expect(h.remote.labels.find((l) => l.name === "norn:wf:triage")?.description).toStartWith("Check an issue still holds");
      expect(text(r)).toContain(`labels: created ${ALL.join(", ")}`);
      // B29: norn made the labels, so the next steps do not ask for them
      expect(r.stdout).not.toContain("gh label create");
      const json = (await h.norn("init", "--json")).value as { labels: LabelsReport };
      expect(json.labels).toEqual({ checked: true, created: [], existing: ALL, missing: [], not_created: [], unused: [] });
    } finally {
      h.cleanup();
    }
  });

  test("B8, B10: an existing label is left as it is; an unused workflow label is listed with its delete command, never deleted", async () => {
    const h = await createHarness();
    try {
      h.remote.labels = [
        { name: "norn", color: "D93F0B", description: "pick me" },
        { name: "norn:wf:fix", color: "EDEDED", description: "" },
      ];
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(h.remote.labels[0]).toEqual({ name: "norn", color: "D93F0B", description: "pick me" });
      expect(h.remote.labels.map((l) => l.name)).toContain("norn:wf:fix");
      expect(h.remote.calls.filter((c) => c === "label+ norn")).toEqual([]);
      expect(r.stdout).toContain("norn:wf:fix unused");
      expect(r.stdout).toContain("`gh label delete norn:wf:fix`");
    } finally {
      h.cleanup();
    }
  });

  test("B11: no git remote → init succeeds and says labels were not checked", async () => {
    const h = await createHarness();
    try {
      sh(h.root, ["remote", "remove", "origin"]);
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(text(r)).toContain("labels: not checked — no git remote");
      expect(h.remote.calls).not.toContain("labels?");
    } finally {
      h.cleanup();
    }
  });

  test("B12: gh not logged in → init finishes and names gh auth login", async () => {
    const h = await createHarness();
    try {
      h.remote.listLabelsError = portError("gh_auth", "gh label list failed (exit 4): To get started with GitHub CLI, please run: gh auth login");
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(text(r)).toContain("labels: not checked — gh is not logged in: run gh auth login, then norn upgrade");
    } finally {
      h.cleanup();
    }
  });

  test("B13: no permission → each label named with its create command; the exit code is unchanged", async () => {
    const h = await createHarness();
    try {
      h.remote.createLabelError = portError("gh_auth", "gh label create failed (exit 1): HTTP 403: Resource not accessible by integration");
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(r.stdout).toMatch(/norn:wf:triage not created: permission denied — `gh label create norn:wf:triage --color 5319E7 --description "Check an issue still holds[^`]*"`/);
      const json = (await h.norn("init", "--json")).value as { labels: LabelsReport & { checked: true } };
      expect(json.labels.not_created.map((n) => n.name)).toEqual(ALL);
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade creates what is missing, on every run (GR10)", () => {
  test("B2, B4, B7: a new workflow's label is created even with nothing else to upgrade; a second run creates nothing", async () => {
    const h = await inited();
    try {
      addWorkflow(h, "release");
      const r = await h.norn("upgrade");
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("labels: created norn:wf:release");
      expect(h.remote.labels.map((l) => l.name)).toContain("norn:wf:release");
      const again = await h.norn("upgrade", "--json");
      expect((again.value as { labels: LabelsReport }).labels).toMatchObject({ checked: true, created: [], existing: expect.arrayContaining(["norn:wf:release", ...ALL]) });
      const text = await h.norn("upgrade");
      expect(text.stdout).toContain(`labels: ${ALL.length + 1} already there`);
    } finally {
      h.cleanup();
    }
  });

  test("B5: an invalid workflow gets no label and is named, pointing at norn doctor", async () => {
    const h = await inited();
    try {
      addWorkflow(h, "spike", "name: spike\nsteps: nope\n");
      const r = await h.norn("upgrade");
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("norn:wf:spike not created: workflow spike is invalid — `norn doctor`");
      expect(h.remote.labels.map((l) => l.name)).not.toContain("norn:wf:spike");
    } finally {
      h.cleanup();
    }
  });

  test("B14: a failed listing → labels not checked, run norn upgrade again; the rest of upgrade stays done", async () => {
    const h = await inited();
    try {
      h.remote.listLabelsError = portError("gh_network", "gh label list failed (exit 1): error connecting to api.github.com");
      const r = await h.norn("upgrade");
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("labels: not checked — gh label list failed (exit 1): error connecting to api.github.com: run norn upgrade again");
    } finally {
      h.cleanup();
    }
  });
});

describe("norn doctor checks the labels (A7, GR10)", () => {
  type Doctor = { warnings: string[]; labels?: LabelsReport };
  const doctor = (h: Harness, ...args: string[]) => runChecked(["doctor", "--json", ...args], h.deps);

  test("B16, B17: a missing label and an unused one are warnings, never a failure of their own", async () => {
    const h = await inited();
    try {
      h.remote.labels = [...h.remote.labels.filter((l) => l.name !== "norn:wf:reproduce"), { name: "norn:wf:fix", color: "EDEDED", description: "" }];
      const before = h.remote.labels.length;
      const v = (await doctor(h)).value as Doctor;
      expect(v.warnings).toContain("label norn:wf:reproduce is missing on the remote: run `norn upgrade`");
      expect(v.warnings).toContain("label norn:wf:fix is unused (names no workflow): `gh label delete norn:wf:fix` deletes it");
      expect(h.remote.labels).toHaveLength(before); // doctor creates nothing
      expect(h.remote.calls.filter((c) => c.startsWith("label+"))).toHaveLength(ALL.length); // only init's
    } finally {
      h.cleanup();
    }
  });

  test("B18: labels not checked is a warning naming the fix", async () => {
    const h = await inited();
    try {
      h.remote.listLabelsError = portError("gh_auth", "gh label list failed (exit 4): gh auth login");
      const v = (await doctor(h)).value as Doctor;
      expect(v.warnings).toContain("labels not checked: gh is not logged in (gh auth login)");
    } finally {
      h.cleanup();
    }
  });

  test("B19: doctor --repo never lists the remote's labels", async () => {
    const h = await inited();
    try {
      const calls = h.remote.calls.length;
      const v = (await doctor(h, "--repo")).value as Doctor;
      expect(v.labels).toBeUndefined();
      expect(h.remote.calls.slice(calls)).not.toContain("labels?");
    } finally {
      h.cleanup();
    }
  });
});
