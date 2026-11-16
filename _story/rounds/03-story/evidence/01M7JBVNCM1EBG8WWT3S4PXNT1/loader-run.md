
### 03.AC1/AC2/AC3/AC4/AC5 happy use (start, base.step via use step; route to included step direct)
listed: w
--- source:
name: w
defaults:
  deadline: 20m
  nudges: 2
start: impl
counters:
  test_loop:
    max: 3
  c1:
    max: 2
base:
  step: update
  verify: test
steps:
  impl:
    type: agent
    skill: implement
    outcomes:
      done: update
      retest: test
  update:
    type: git
    action: update
    outcomes:
      done: test
      conflict: resolve
  resolve:
    type: agent
    skill: merge
    outcomes:
      done: test
      gave_up:
        to: impl
        counter: test_loop
        means: cannot merge
        verdict: fail
      loop:
        to: update
        counter: c1
  test:
    type: check
    run: bun test
    timeout: 5m
    outcomes:
      pass:
        to: qa
        means: green
        verdict: pass
      fail:
        to: impl
        counter: test_loop
      odd: $stuck
      give: $stuck
      ok: $done
  qa:
    type: gate
    outcomes:
      approve: $done
      reject: impl

hash==sha256(source): true source==file: false
validate: ["check outcome 'odd' is neither pass, fail nor named by an exit code in exits","check outcome 'give' is neither pass, fail nor named by an exit code in exits","check outcome 'ok' is neither pass, fail nor named by an exit code in exits","test.pass declares verdict 'pass', but only outcomes an agent reports with norn done can be gated by a verdict","cycle without a counter: impl.retest → test.pass → qa.reject → impl","cycle without a counter: impl.done → update.conflict → resolve.done → test.pass → qa.reject → impl","cycle without a counter: impl.done → update.done → test.pass → qa.reject → impl"]

### 03.AC2 start names use step
listed: w
--- source:
name: w
defaults:
  deadline: 20m
  nudges: 2
start: update
counters:
  test_loop:
    max: 3
  c1:
    max: 2
steps:
  impl:
    type: agent
    skill: implement
    outcomes:
      done: update
      retest: test
  update:
    type: git
    action: update
    outcomes:
      done: test
      conflict: resolve
  resolve:
    type: agent
    skill: merge
    outcomes:
      done: test
      gave_up:
        to: impl
        counter: test_loop
        means: cannot merge
        verdict: fail
      loop:
        to: update
        counter: c1
  test:
    type: check
    run: bun test
    timeout: 5m
    outcomes:
      pass:
        to: qa
        means: green
        verdict: pass
      fail:
        to: impl
        counter: test_loop
      odd: $stuck
      give: $stuck
      ok: $done
  qa:
    type: gate
    outcomes:
      approve: $done
      reject: impl

hash==sha256(source): true source==file: false
validate: ["check outcome 'odd' is neither pass, fail nor named by an exit code in exits","check outcome 'give' is neither pass, fail nor named by an exit code in exits","check outcome 'ok' is neither pass, fail nor named by an exit code in exits","test.pass declares verdict 'pass', but only outcomes an agent reports with norn done can be gated by a verdict","cycle without a counter: impl.retest → test.pass → qa.reject → impl","cycle without a counter: impl.done → update.conflict → resolve.done → test.pass → qa.reject → impl","cycle without a counter: impl.done → update.done → test.pass → qa.reject → impl"]

### 03.AC2 reset_on names use step
listed: (none)
REFUSED w.yaml /counters/c1/reset_on - `base` is a use step: name the step of shared/bu.yaml whose edge resets the counter

### 03.AC2 base.verify names use step
listed: (none)
REFUSED w.yaml /base/verify - `base` is a use step: name the check step of shared/bu.yaml

### 03.AC4 shared route to workflow step
listed: (none)
REFUSED w.yaml /steps/test/outcomes/fail - shared/bu.yaml: `impl` is not a step of this file; a shared file leaves through an exit (`{ exit: <name> }`)

### 03.AC6 missing shared
listed: (none)
REFUSED w.yaml /steps/base/use - shared file `shared/nope.yaml` not found in `.agents/workflows/shared/`

### 03.AC7 included step named like workflow step
listed: (none)
REFUSED w.yaml /steps/test - step `test` comes from shared/bu.yaml and from the workflow

### 03.AC7 included step named like use step
listed: (none)
REFUSED w.yaml /steps/update - step `update` comes from shared/bu.yaml and is the name of the use step that brings it in

### 03.AC7 clash with another shared file
listed: (none)
REFUSED w.yaml /steps/test - step `test` comes from shared/bu.yaml and from shared/o2.yaml

### 03.AC7 same shared used twice
listed: (none)
REFUSED w.yaml /steps/again/use - shared/bu.yaml is used twice, by `base` and `again`: its step `update` would come from both

### 03.AC8 routes exit file lacks
listed: (none)
REFUSED w.yaml /steps/base/outcomes/bogus - `bogus` is not an exit of shared/bu.yaml (its exits: broken, tested, weird)

### 03.AC8 nested use
listed: (none)
REFUSED w.yaml /steps/inner/use - shared/bu.yaml: a shared file cannot use another shared file

### 03.AC8 shared holds name
listed: (none)
REFUSED w.yaml /name - shared/bu.yaml: `name` belongs in the workflow

### 03.AC8 shared holds counters
listed: (none)
REFUSED w.yaml /counters - shared/bu.yaml: `counters` belongs in the workflow

### 03.AC8 shared holds defaults
listed: (none)
REFUSED w.yaml /defaults - shared/bu.yaml: `defaults` belongs in the workflow

### 03.AC8 shared holds mode
listed: (none)
REFUSED w.yaml /mode - shared/bu.yaml: `mode` belongs in the workflow

### 03.AC8 shared holds base
listed: (none)
REFUSED w.yaml /base - shared/bu.yaml: `base` belongs in the workflow

### 03.AC9 no use: source byte for byte (comments kept)
listed: w
--- source:
# a comment
name: w
defaults: { deadline: 20m, nudges: 2 }
start: impl
counters: { test_loop: { max: 3 }, c1: { max: 2 } }
steps:
  impl: { type: agent, skill: implement, outcomes: { done: base, retest: test } }
  qa: { type: gate, outcomes: { approve: $done, reject: impl } }
  base: { type: gate, outcomes: { approve: qa } }
  test: { type: gate, outcomes: { approve: qa } }

hash==sha256(source): true source==file: true
validate: ["cycle without a counter: impl.done → base.approve → qa.reject → impl","cycle without a counter: impl.retest → test.approve → qa.reject → impl"]

### 04.AC1/AC4 like within workflow, no use
listed: w
--- source:
name: w
defaults:
  deadline: 20m
  nudges: 2
start: impl
counters:
  test_loop:
    max: 3
  c1:
    max: 2
steps:
  impl:
    type: agent
    skill: implement
    outcomes:
      done: base
      retest: test
  test:
    type: check
    run: bun test
    timeout: 7m
    outcomes:
      pass: qa
      fail: impl
  test-merge:
    type: check
    run: bun test
    timeout: 7m
    outcomes:
      pass: $done
      fail: impl
    description: copy
  qa:
    type: gate
    outcomes:
      approve: test-merge
      reject: impl
  base:
    type: gate
    outcomes:
      approve: qa

hash==sha256(source): true source==file: false
validate: ["cycle without a counter: impl.done → base.approve → qa.reject → impl","cycle without a counter: impl.done → base.approve → qa.approve → test-merge.fail → impl","cycle without a counter: impl.retest → test.fail → impl","cycle without a counter: impl.retest → test.pass → qa.reject → impl","cycle without a counter: impl.retest → test.pass → qa.approve → test-merge.fail → impl"]

### 04.AC2 like inside shared file
listed: w
--- source:
name: w
defaults:
  deadline: 20m
  nudges: 2
start: impl
counters:
  test_loop:
    max: 3
  c1:
    max: 2
steps:
  impl:
    type: agent
    skill: implement
    outcomes:
      done: update
      retest: test
  update:
    type: git
    action: update
    outcomes:
      done: test
      conflict: resolve
  resolve:
    type: agent
    skill: merge
    outcomes:
      done: test
      gave_up:
        to: impl
        counter: test_loop
        means: cannot merge
        verdict: fail
      loop:
        to: update
        counter: c1
  test:
    type: check
    run: bun test
    timeout: 5m
    outcomes:
      pass:
        to: qa
        means: green
        verdict: pass
      fail:
        to: impl
        counter: test_loop
      odd: $stuck
      give: $stuck
      ok: $done
  test2:
    type: check
    run: bun test
    timeout: 9m
    outcomes:
      pass:
        to: qa
        means: green
        verdict: pass
      fail:
        to: impl
        counter: test_loop
      odd: $stuck
      give: $stuck
      ok: $done
  qa:
    type: gate
    outcomes:
      approve: $done
      reject: impl

hash==sha256(source): true source==file: false
validate: ["check outcome 'odd' is neither pass, fail nor named by an exit code in exits","check outcome 'give' is neither pass, fail nor named by an exit code in exits","check outcome 'ok' is neither pass, fail nor named by an exit code in exits","check outcome 'odd' is neither pass, fail nor named by an exit code in exits","check outcome 'give' is neither pass, fail nor named by an exit code in exits","check outcome 'ok' is neither pass, fail nor named by an exit code in exits","test.pass declares verdict 'pass', but only outcomes an agent reports with norn done can be gated by a verdict","test2.pass declares verdict 'pass', but only outcomes an agent reports with norn done can be gated by a verdict","cycle without a counter: impl.retest → test.pass → qa.reject → impl","cycle without a counter: impl.done → update.conflict → resolve.done → test.pass → qa.reject → impl","cycle without a counter: impl.done → update.done → test.pass → qa.reject → impl"]

### 04.AC3 like missing
listed: (none)
REFUSED w.yaml /steps/test-merge/like - `nope` is not a step of this file

### 04.AC3 like self
listed: (none)
REFUSED w.yaml /steps/test-merge/like - a step cannot be like itself

### 04.AC3 like a like
listed: (none)
REFUSED w.yaml /steps/t3/like - `test-merge` is a like step: name the step it copies, `test`

### 04.AC3 like a use step
listed: (none)
REFUSED w.yaml /steps/cp/like - `base` is a use step: like copies a step written in its own file

### 04.AC3 like a shared step from workflow
listed: (none)
REFUSED w.yaml /steps/cp/like - `resolve` is a step of shared/bu.yaml: like copies a step of its own file

### 04.AC3 shared step likes workflow step
listed: (none)
REFUSED w.yaml /steps/cp/like - shared/bu.yaml: `impl` is a step of the workflow: like copies a step of its own file

### 04.AC3 use step carries like
listed: (none)
REFUSED w.yaml /steps/base/like - a use step cannot carry `like`
