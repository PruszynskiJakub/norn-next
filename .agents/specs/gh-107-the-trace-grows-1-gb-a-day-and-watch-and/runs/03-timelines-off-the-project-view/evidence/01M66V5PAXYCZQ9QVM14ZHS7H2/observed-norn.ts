import { setTraceReadObserver } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-107-the-trace-grows-1-gb-a-day-and-watch-and--03-timelines-off-the-project-view/packages/store/src/index.ts";
setTraceReadObserver(({ file }) => process.stderr.write("TRACE-READ " + file.split("/").pop() + "\n"));
await import("/Users/jakubpruszynski/Projects/norn-worktrees/gh-107-the-trace-grows-1-gb-a-day-and-watch-and--03-timelines-off-the-project-view/packages/cli/src/main.ts");
