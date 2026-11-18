import { defineNornPlugin } from "@norn/plugin-api";
import { integrate } from "./steps/integrate.ts";
import { push } from "./steps/push.ts";
import { updateBranch } from "./steps/update-branch.ts";
import { verifyBase } from "./steps/verify-base.ts";
import { gitVcsFactory } from "./vcs.ts";

export const vcsGitPlugin = defineNornPlugin({
  name: "norn-vcs-git",
  api: "^1.4",
  provides: {
    vcs: { git: gitVcsFactory },
    stepKinds: { "update-branch": updateBranch, integrate, push, "verify-base": verifyBase },
  },
});
