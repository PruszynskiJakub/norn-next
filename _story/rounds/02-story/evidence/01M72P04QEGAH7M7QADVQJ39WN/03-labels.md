## 03.AC3: missing labels created (stub gh lists only 'norn'); origin = a placeholder github url
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":["norn-qa"],"linked":[]},"staged":[".agents/skills/norn-qa",".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":true,"created":["norn:wf:quick","norn:wf:refinement","norn:wf:reproduce","norn:wf:slice","norn:wf:story","norn:wf:triage","norn:kind:bug","norn:kind:feature","norn:kind:security","norn:kind:chore","norn:kind:docs","norn:risk:low","norn:risk:medium","norn:risk:high","norn:priority:low","norn:priority:medium","norn:priority:high","norn:priority:extreme"],"existing":["norn"],"missing":[],"not_created":[],"unused":[]}}

exit=0  repo+machine-dir changed: YES

### gh calls made:
    gh label list --limit 1000 --json name,color,description
    gh label create norn:wf:quick --color 5319E7 --description Make a small change (refactor, docs, chore, a reproduced bug's fix), check and review it, open the …
    gh label create norn:wf:refinement --color 5319E7 --description Agree a story's spec and plan with a person, against the current base; no code.
    gh label create norn:wf:reproduce --color 5319E7 --description Reproduce a bug through the real interface, confirm its cause and the seam for a regression test; c…
    gh label create norn:wf:slice --color 5319E7 --description Build one slice test-first, check and review it, and integrate it into the story branch.
    gh label create norn:wf:story --color 5319E7 --description Slice a planned story against the current base, run the slices, verify the story, open the draft PR…
    gh label create norn:wf:triage --color 5319E7 --description Check an issue still holds, add its context, and recommend what comes next (refinement, quick, repr…
    gh label create norn:kind:bug --color 5319E7 --description Kind: something does not work as it should
    gh label create norn:kind:feature --color 5319E7 --description Kind: new or changed behaviour for users
    gh label create norn:kind:security --color 5319E7 --description Kind: a vulnerability or security hardening
    gh label create norn:kind:chore --color 5319E7 --description Kind: maintenance (dependencies, tooling, CI, refactors)
    gh label create norn:kind:docs --color 5319E7 --description Kind: documentation only
    gh label create norn:risk:low --color 5319E7 --description Risk: a two-way door with a small blast radius, easy to undo
    gh label create norn:risk:medium --color 5319E7 --description Risk: a two-way door that touches shared code or behaviour
    gh label create norn:risk:high --color 5319E7 --description Risk: a one-way door or a wide blast radius
    gh label create norn:priority:low --color 5319E7 --description Priority: can wait until there is room
    gh label create norn:priority:medium --color 5319E7 --description Priority: do it soon, in the normal flow
    gh label create norn:priority:high --color 5319E7 --description Priority: do it next; it blocks or hurts work now
    gh label create norn:priority:extreme --color 5319E7 --description Priority: drop other work (broken main, data loss, a security hole)
(only list + create; no edit/delete)
## 03.AC3: remote unreachable (stub gh fails every call)
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":["norn-qa"],"linked":[]},"staged":[".agents/skills/norn-qa",".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":false,"reason":"gh label list failed (exit 1): error connecting to api.github.com","fix":null,"do_instead":"run norn upgrade again"}}

exit=0  repo+machine-dir changed: YES

norn_version now: norn_version: 0.31.0
### markdown
labels: not checked — gh label list failed (exit 1): error connecting to api.github.com: run norn upgrade again
exit=0  repo+machine-dir changed: YES
