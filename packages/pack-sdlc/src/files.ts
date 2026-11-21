/**
 * The pack's files as text: the shipped workflows (with the routes the kernel loader needs), the
 * shared files they `use`, and the bundled skills, and the roles the workflows name, as data. Kept as data, so the plugin carries no code a
 * workflow could reach and loads without touching the disk.
 */
import type { Pack } from "@norn/plugin-api";
import { ROLES } from "./roles.ts";
import { SKILLS } from "./skills.ts";
import { SHARED, WORKFLOWS } from "./workflows.ts";

export const SDLC_PACK: Pack = { workflows: WORKFLOWS, shared: SHARED, skills: SKILLS, roles: ROLES };
