/**
 * The roles the shipped workflows' agent steps name with `by:`: what each one's agent is for and the
 * capabilities it may be granted. Which executor runs a role is each machine's `bind:`.
 */
import type { RoleDefinition } from "@norn/plugin-api";

export const ROLES: Record<string, RoleDefinition> = {
  builder: { purpose: "Builds the change: writes code and the story's documents, and runs anything it needs.", allow: ["code:write", "docs:write", "exec:any"] },
  reviewer: { purpose: "Reviews a change against its spec and the repo's standards, and hands back findings; changes no code.", allow: ["code:read", "exec:checks", "out:findings"] },
  qa: { purpose: "Checks a change from the user's side by running it, and gives each criterion a verdict with evidence.", allow: ["code:scratch", "exec:any", "out:criteria", "out:evidence", "out:findings"] },
  investigator: { purpose: "Reproduces and triages: may run anything, keeps no code, and reports on the item.", allow: ["code:scratch", "exec:any", "out:findings", "tracker:comment", "tracker:label"] },
  writer: { purpose: "Writes the story's documents: specs, plans, slices and the pull request body.", allow: ["docs:write"] },
  supervisor: { purpose: "Stands in for the person on what the person's policy grants: answers questions and decides granted gates, and escalates the rest.", allow: ["read:any", "answer", "decide:granted", "escalate"], supervises: true },
};
