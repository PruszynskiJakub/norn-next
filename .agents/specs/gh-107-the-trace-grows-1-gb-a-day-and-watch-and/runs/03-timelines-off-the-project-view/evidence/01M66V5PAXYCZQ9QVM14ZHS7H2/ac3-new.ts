import { loadProjectView, loadTimelines } from "@norn/view";
const [repoRoot, now] = [process.argv[2]!, Number(process.argv[3])];
const env = { NORN_HOME_DIR: process.argv[4] };
const v = await loadProjectView({ repoRoot, now, env });
const t = loadTimelines({ repoRoot, now, env });
console.log(JSON.stringify({ timeline: t.timeline, errors: t.errors, view_has_timeline: "timeline" in v, view_errors: v.errors }));
