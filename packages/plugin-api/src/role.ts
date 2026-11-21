/**
 * Roles (plugin API 1.23): what an agent step's `by:` names. A role says what its agent is for and the
 * capabilities it may be granted; which executor runs it is the machine's choice (the config's
 * `bind:`), never the role's, so a workflow stays portable. A pack registers its roles beside its
 * workflows.
 */

import { CAPABILITIES, type Capability } from "@norn/schema";

/** Every capability a role may be granted: the schema holds the list, so the published workflow schema accepts the same `allow:`. */
export { CAPABILITIES, type Capability } from "@norn/schema";

export interface RoleDefinition {
  /** what the role's agent is for, in a sentence */
  purpose: string;
  /** the capabilities the role may be granted; a step's `allow:` narrows them, never widens */
  allow: readonly Capability[];
  /** the role supervises steps for the person rather than doing one, so no step names it with `by:` */
  supervises?: true;
}

export const ROLE_NAME_PATTERN = "^[a-z][a-z0-9_-]*$";
const ROLE_NAME_RE = new RegExp(ROLE_NAME_PATTERN);
const KNOWN: ReadonlySet<string> = new Set(CAPABILITIES);

/** The roles a step may name with `by:`, in the order given: every role but a supervisor. */
export function stepRoles(roles: Readonly<Record<string, RoleDefinition>>): string[] {
  return Object.entries(roles)
    .filter(([, r]) => r.supervises !== true)
    .map(([name]) => name);
}

/** What is wrong with the roles a pack offers; empty when they fit the contract. */
export function rolesProblems(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return ["roles must be an object of roles"];
  const out: string[] = [];
  for (const [name, role] of Object.entries(value as Record<string, unknown>)) {
    if (!ROLE_NAME_RE.test(name)) out.push(`role name ${JSON.stringify(name)} must match ${ROLE_NAME_PATTERN}`);
    if (role === null || typeof role !== "object" || Array.isArray(role)) {
      out.push(`role ${name} must be an object with purpose and allow`);
      continue;
    }
    const r = role as Record<string, unknown>;
    if (typeof r.purpose !== "string" || r.purpose.trim() === "") out.push(`role ${name} needs a purpose`);
    if (!Array.isArray(r.allow)) out.push(`role ${name} needs allow, a list of capabilities`);
    else {
      const seen = new Set<unknown>();
      for (const c of r.allow) {
        if (!KNOWN.has(c as string)) out.push(`role ${name} asks for ${String(c)}, which is not a capability: name one of ${CAPABILITIES.join(", ")}`);
        else if (seen.has(c)) out.push(`role ${name} names ${String(c)} twice`);
        seen.add(c);
      }
    }
    if (r.supervises !== undefined && r.supervises !== true) out.push(`role ${name}: supervises is true or left out`);
  }
  return out;
}
