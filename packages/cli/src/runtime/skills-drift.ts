/**
 * gh-61 B20 (D11): a session started by hand (`norn brief`, `norn story start`, `norn story chat`) is
 * refused when the worktree its agent runs in holds bundled skills that differ from this norn's —
 * the same rule that holds a launched agent. B21: only bundled skills; D14: a worktree moving the
 * version forward is not checked.
 */
import { join } from "node:path";
import { skillsDriftHint } from "@norn/core";
import { worktreeSkillsDrift } from "@norn/store";
import type { Context } from "../context.ts";
import { refuse } from "../output.ts";
import { assetsDir } from "./assets.ts";
import { bundledSkills } from "./workflows.ts";

export function refuseOnSkillsDrift(ctx: Context, worktree: string, story: string): void {
  const drifted = worktreeSkillsDrift(worktree, join(assetsDir(ctx.env), "skills"), bundledSkills(ctx.env), ctx.version);
  if (drifted.length) throw refuse(skillsDriftHint.text(ctx.version, drifted), skillsDriftHint.fix(story), "skills_drift");
}
