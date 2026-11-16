import { load } from "./lib.ts";
const t = `name: wf\nstart: a\nsteps:\n  a:\n    agent: Do.\n    skills: [norn-implement, ghost-one, ghost-two]\n    outcomes: { done: $done }\n    means: { done: ok }\n`;
const r = load(t, "checkout", {}, { skills: ["norn-implement", "norn-tdd"] });
console.log("validateWorkflowDefinition({skills: installed list}):", JSON.stringify(r.issues, null, 1));
