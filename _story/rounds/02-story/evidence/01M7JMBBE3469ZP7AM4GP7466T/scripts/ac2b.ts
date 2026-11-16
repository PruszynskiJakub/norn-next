import { load } from "./lib.ts";
const wf = (step: string, outs: string) => `name: wf\nstart: s\nsteps:\n  s:\n    ${step}\n    outcomes: ${outs}\n`;
for (const [s, o] of [["type: merge", "{ done: $done }"], ["type: slices", "{ clean: $done }"]]) {
  const r = load(wf(s, o), "copy"); console.log("old copy", s, o, JSON.stringify(r.refused ?? r.issues));
}
