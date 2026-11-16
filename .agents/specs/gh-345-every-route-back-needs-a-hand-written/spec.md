---
id: gh-345
slug: every-route-back-needs-a-hand-written
provider: gh
number: 345
url: https://github.com/PruszynskiJakub/norn-next/issues/345
title: Every route back needs a hand-written named counter
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:medium
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-16T18:42:38.834Z
body_hash: 3f838c286b80dba0453f1d471d2c2076536a71ad272f588e78bbd5ade8d2e576
---

## Observed

On `main` (`e419d33bd`), norn 0.33.0.

- A workflow with a loop is refused unless some edge of the loop names a counter (`uncounted_cycle`, `packages/core/src/workflow.ts:253-270`), and each name must be declared in `counters:` (`unknown_counter`, `workflow.ts:230`).
- `story.yaml` declares 10 counters, `quick.yaml` 8. Each is used far from where it is declared.
- The maxima follow the kind of edge: a failed check 5 (`test_loop`) or 3 (`ci_loop`); an agent sending work back 3 or 2; a gate's reject 2 or 3; a conflict 2, reset when the update succeeds; `stale` 10.

## Wanted

For whoever writes a workflow: nothing to write unless the default is wrong. For whoever resumes a stuck story: the counter still has a name.

1. An edge with no `counter:` gets a derived counter, named `<step>.<outcome>`:

   | Edge | Default max | Resets |
   |---|---|---|
   | a check's `fail`, or an outcome named by `exits` other than `stale` | 5 | never |
   | a gate's `reject` | 2 | never |
   | a `conflict` | 2 | on any other outcome of the same step |
   | `stale`, on any step kind | 10 | never |
   | an agent outcome other than `done`, `pass`, `approve`, that lies on a loop left uncounted by the rows above | 3 | never |

2. `max:` on the edge overrides the default: `fail: { to: implement, max: 3 }`.
3. `counter: <name>` on an edge and the `counters:` block keep working, for one counter shared by several edges and for a custom `reset_on`. An edge with `counter:` gets no derived one.
4. A loop still uncounted after derivation is refused as today (`uncounted_cycle`).
5. A derived counter appears under its name in `state.json` `counters`, in the exhausted park (`packages/schema/src/state.ts:85`), in the brief's `at_limit`, and is accepted by `norn run rerun --reset <step>.<outcome>`.
6. The shipped workflows drop every counter whose max and reset match the defaults, and keep the rest as overrides or shared names. Loaded, each has the same bound on the same edges as today.

Must hold: for each shipped workflow, the set of (edge, max, edges sharing a counter, reset edges) is unchanged. Counter names may change; golden cases are updated for the names only, and the diff shows no changed decision.

Open for refinement: whether `<step>.<outcome>` is acceptable as a counter name in every place a name is stored (`CounterName` allows `[a-z][a-z0-9_-]*`, `packages/schema/src/common.ts:30`, so the dot needs a decision).

Best done after #342: shared exits merge the three test failures into one edge.

Design record: https://gist.github.com/PruszynskiJakub/0dcf9042145fe9c46f32bd9b8b94fb19 (section 5 lists each of `quick`'s counters against its derived value)

## Where

- `packages/core/src/workflow.ts:212-270`
- `packages/schema/src/workflow.ts:183-197`: `CounterSpec`; `packages/schema/src/common.ts:30`
- `packages/core/src/apply.ts:140,362-368,410-424`
- `packages/schema/src/state.ts:85,161`
- `packages/cli/src/commands/run-rerun.ts:20-34`
