$ bun test test/repo/repo.test.ts -t "record folder"
bun test v1.3.13 (bf2e2cec)

 2 pass
 58 filtered out
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [100.00ms]

$ independent grep: runs path segments in package sources (non-comment)
$ independent grep (incl. /runs/ forms the matcher misses): non-comment package-source lines with a runs path segment, outside ids.ts/paths.ts
packages/cli/src/runtime/human.ts:241:    if (!t.runsDir) throw refuse(`${t.key} is held here but its runs/ are not in this checkout`, cmd.tick(), "story_not_local");
packages/cli/src/commands/tidy.ts:91:  summary: "Report or clean orphan worktrees, branches, stale leases, receipt reservations (K5), runs/ work not in the record (R2.3), Herdr panes of runs that reported done (K7) and trace days, hook files, briefings and transcripts older than trace.retain (D12)",
packages/cli/src/commands/run-cancel.ts:31:      return refuse(`${t.story}'s claim is ${who}; only the claim holder stops its runs`, cmd.storyCheckout(t.story), "not_holder");
packages/cli/src/commands/init.ts:36:const GENERATED = [".agents/specs/*/runs/** linguist-generated=true gitlab-generated=true"];
packages/cli/src/commands/help.ts:34:  { title: "Agent protocol: the only commands an agent runs", for: "agent", commands: ["brief", "done", "ask", "stuck"] },
packages/core/src/brief.ts:610:      "`--criteria <file>`: a JSON array with one verdict per acceptance criterion — `pass` (with `evidence`), `fail` (with `repro`), `person` (with `how`), `unverified` (with `reason` and `how`). Worst verdict: fail > unverified > person > pass. Write the file outside the repository, next to your evidence (e.g. `$TMPDIR/criteria.json`); never under `runs/`.",
packages/core/src/brief.ts:624:  out.push("", "Then end your turn. Never edit `runs/`; never push.", "");
packages/core/src/decide/story.ts:262:  if (rebasing(uf)) return ctx.noop(ref, "unit.rebase_in_progress", `rebase in progress in ${uf.worktree?.path}; runs/ rewound — held until it is concluded (H1)`);

Verdict: the repo test (2 tests: matcher + scan) passes; the wider independent grep (which also catches `/runs/` forms the matcher misses, per review note 1) finds only prose strings and init's .gitattributes glob, no hand-built unit record path.
