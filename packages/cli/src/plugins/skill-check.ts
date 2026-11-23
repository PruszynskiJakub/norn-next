/**
 * Which skills a repo workflow's agent steps name that norn cannot see: the brief tells the agent to
 * use each by name, and one that is nowhere sends it looking for nothing. A skill is seen when
 * `lookupSkills` finds it, the one lookup `norn skill list` prints. The harness also loads skills norn
 * cannot see (a user-level folder, a harness plugin's `plugin:skill`), so an unseen skill is a warning
 * for doctor, never a refusal: refusing would stop every story on a workflow that runs. A name with a
 * `:` is a harness plugin's and is not looked for. Only the repo's workflows are read: a pack's are its
 * plugin's to keep whole, with their own tests.
 */
import { repoFileOf, type RuntimeEnv, SKILLS_DIR } from "@norn/runtime";
import { lookupSkills } from "../skill-lookup.ts";

interface Unseen {
  file: string;
  step: string;
  skill: string;
}

export async function unseenSkillWarning(env: RuntimeEnv): Promise<string | null> {
  const found = new Set((await lookupSkills(env.slots.pack.skills, { files: env.ctx.files, root: env.ctx.repo.root, harnesses: Object.values(env.slots.executors) })).map((s) => s.name));
  const isSeen = (skill: string): boolean => skill.includes(":") || found.has(skill);
  const unseen: Unseen[] = [];
  for (const [name, load] of Object.entries(env.workflows)) {
    const file = repoFileOf(env.repoWorkflows, name, "workflow");
    if (!load.ok || file === null) continue;
    for (const step of Object.values(load.workflow.graph.steps))
      for (const skill of step.agent?.skills ?? []) if (!isSeen(skill)) unseen.push({ file, step: step.name, skill });
  }
  if (unseen.length === 0) return null;
  const files = [...new Set(unseen.map((m) => m.file))];
  const skills = [...new Set(unseen.map((m) => m.skill))];
  const what = files.map((f) => `${f} names a skill neither the pack nor the repo has: ${unseen.filter((m) => m.file === f).map((m) => `${m.skill} (step ${m.step})`).join(", ")}`).join("; ");
  return `${what}; fine if the harness loads ${skills.length === 1 ? "it" : "them"} from a user-level folder, else write ${skills.map((s) => `${SKILLS_DIR}/${s}/SKILL.md`).join(", ")}`;
}
