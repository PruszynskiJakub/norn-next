$ norn doctor --repo --json  (workflows)
broken ok=false ["shared file `shared/missing.yaml` not found in `.agents/workflows/shared/`"]
loopy ok=false ["shared/back.yaml, step 'work': counter 'ghost' is not declared in counters","shared/back.yaml, step 'work': cycle without a counter: work.again → work"]
quick ok=true []
refinement ok=true []
reproduce ok=true []
slice ok=true []
story ok=true []
triage ok=true []

$ norn doctor --repo (markdown, workflow lines)
norn doctor: 2 checks failed (workflow broken, workflow loopy)
  FAIL workflow broken .agents/workflows/broken.yaml
                      ! /steps/b/use: shared file `shared/missing.yaml` not found in `.agents/workflows/shared/`
  FAIL workflow loopy .agents/workflows/loopy.yaml
                      ! /steps/work/outcomes/retry: shared/back.yaml, step 'work': counter 'ghost' is not declared in counters
                      ! /steps/work: shared/back.yaml, step 'work': cycle without a counter: work.again → work
