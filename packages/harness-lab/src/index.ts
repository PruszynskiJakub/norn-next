import { defineNornPlugin, type Harness } from "@norn/plugin-api";
import { LAB_HARNESS } from "./agent.ts";
import { install, launch, uninstall } from "./launch.ts";
import { normalize, respond } from "./protocol.ts";

export { LAB_AUTHOR, LAB_HARNESS, type LabAgentResult, type LabAgentRun, runLabAgent } from "./agent.ts";
export { beatFor, LabBeat, LabBeats, LabReport, type LabVisit, LabWork } from "./beats.ts";
export { LAB_AGENT_COMMAND, selfOfHookCommand, shellWords } from "./launch.ts";
export { LAB_HOOKS, type LabHook } from "./protocol.ts";

/** Where `norn lab-agent` reads the beat script it plays: a JSON file of LabBeats, set in the env norn runs in. */
export const LAB_BEATS_ENV = "NORN_LAB_BEATS";

/**
 * A deterministic stand-in for a coding agent: it runs no model and makes no network call. It
 * resumes its session to take an answer, and the answer comes in its resumed prompt, which is the
 * one way norn adds to a headless agent's context; nothing else of a real agent's hooks is modelled.
 */
export const labHarness: Harness = Object.freeze({
  name: LAB_HARNESS,
  capabilities: Object.freeze({ blockStop: false, denyTool: false, injectContext: true, subagents: false, limits: false, paneInput: false, promptMarks: true, resume: true }),
  install,
  uninstall,
  launch,
  normalize,
  respond,
});

export const labPlugin = defineNornPlugin({ name: "norn-harness-lab", api: "^1", provides: { harness: { [LAB_HARNESS]: labHarness } } });
