import { load, show } from "./lib.ts";
show("x", load(`name: wf\nstart: a\nsteps:\n  a:\n    agent: do it\n    outcomes: { done: $done }\n    means: { done: ok }\n`));
