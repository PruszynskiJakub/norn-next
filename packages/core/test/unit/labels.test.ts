/** GR10, GR11 (gh-67 B4–B10): the labels norn uses, planned against what the remote has. */
import { describe, expect, test } from "bun:test";
import { labelCreateCommand, labelDeleteCommand, NORN_LABEL_COLOR, planLabels, TRIAGE_LABELS } from "../../src/labels.ts";

const wf = (name: string, valid = true, description?: string) => ({ name, valid, ...(description ? { description } : {}) });
const SHIPPED = ["triage", "reproduce", "refinement", "story", "slice", "quick"].map((n) => wf(n));

describe("planLabels", () => {
  test("B1, B6: a bare remote misses the intake label, one per workflow and the twelve triage labels", () => {
    const plan = planLabels({ intake: "norn", workflows: SHIPPED, remote: [] });
    expect(plan.missing.map((l) => l.name)).toEqual([
      "norn",
      "norn:wf:quick",
      "norn:wf:refinement",
      "norn:wf:reproduce",
      "norn:wf:slice",
      "norn:wf:story",
      "norn:wf:triage",
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
    ]);
    expect(plan.existing).toEqual([]);
    expect(TRIAGE_LABELS).toHaveLength(12);
  });

  test("B2, B7, B8: labels already there are existing, only the new workflow's is missing", () => {
    const all = planLabels({ intake: "norn", workflows: SHIPPED, remote: [] }).missing.map((l) => l.name);
    const plan = planLabels({ intake: "norn", workflows: [...SHIPPED, wf("release")], remote: all });
    expect(plan.missing.map((l) => l.name)).toEqual(["norn:wf:release"]);
    expect(plan.existing).toEqual(all);
    expect(planLabels({ intake: "norn", workflows: SHIPPED, remote: all }).missing).toEqual([]);
  });

  test("B5: an invalid workflow gets no label and is named", () => {
    const plan = planLabels({ intake: "norn", workflows: [...SHIPPED, wf("spike", false)], remote: [] });
    expect(plan.missing.map((l) => l.name)).not.toContain("norn:wf:spike");
    expect(plan.invalid).toEqual(["spike"]);
  });

  test("B9: descriptions — the workflow's own, a fixed sentence for the others, at most 100 characters", () => {
    const long = "x".repeat(140);
    const plan = planLabels({ intake: "norn", workflows: [wf("quick", true, "Make a small change."), wf("story", true, long), wf("bare")], remote: [] });
    const d = (n: string) => plan.missing.find((l) => l.name === n)?.description;
    expect(d("norn")).toBe("norn takes in issues assigned to you with this label");
    expect(d("norn:wf:quick")).toBe("Make a small change.");
    expect(d("norn:wf:story")).toHaveLength(100);
    expect(d("norn:wf:bare")).toBe("The bare workflow (norn)");
    expect(d("norn:risk:high")).toContain("one-way door");
    for (const l of plan.missing) expect(l.description.length).toBeLessThanOrEqual(100);
    expect(NORN_LABEL_COLOR).toBe("5319E7");
  });

  test("B10: a norn:wf label naming no workflow is unused; an invalid workflow's is not", () => {
    const plan = planLabels({ intake: "norn", workflows: [...SHIPPED, wf("spike", false)], remote: ["norn", "norn:wf:fix", "norn:wf:spike", "bug", "norn:kind:bug"] });
    expect(plan.unused).toEqual(["norn:wf:fix"]);
    expect(plan.existing).toEqual(["norn", "norn:kind:bug"]);
  });

  test("label names compare without case, as the providers do", () => {
    expect(planLabels({ intake: "norn", workflows: [], remote: ["Norn"] }).existing).toEqual(["norn"]);
  });
});

describe("label commands (B10, B13)", () => {
  const label = { name: "norn:wf:triage", color: NORN_LABEL_COLOR, description: 'Check an issue "still" holds' };
  test("gh", () => {
    expect(labelCreateCommand("gh", label)).toBe("gh label create norn:wf:triage --color 5319E7 --description 'Check an issue \"still\" holds'");
    expect(labelDeleteCommand("gh", "norn:wf:fix")).toBe("gh label delete norn:wf:fix");
  });
  test("glab", () => {
    expect(labelCreateCommand("glab", label)).toBe("glab label create --name norn:wf:triage --color '#5319E7' --description 'Check an issue \"still\" holds'");
    expect(labelDeleteCommand("glab", "norn:wf:fix")).toBe("glab label delete norn:wf:fix");
  });
  test("a name or description a shell would split or expand is single-quoted", () => {
    const odd = { name: "needs triage!", color: NORN_LABEL_COLOR, description: "it's $HOME `x` !1" };
    expect(labelCreateCommand("gh", odd)).toBe(`gh label create 'needs triage!' --color 5319E7 --description 'it'\\''s $HOME \`x\` !1'`);
    expect(labelCreateCommand("glab", odd)).toBe(`glab label create --name 'needs triage!' --color '#5319E7' --description 'it'\\''s $HOME \`x\` !1'`);
    expect(labelDeleteCommand("gh", "needs triage!")).toBe("gh label delete 'needs triage!'");
  });
});
