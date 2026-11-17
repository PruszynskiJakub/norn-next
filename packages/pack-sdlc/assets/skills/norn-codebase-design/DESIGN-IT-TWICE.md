# Design It Twice

Your first interface is unlikely to be the best (Ousterhout). When the person wants alternatives for a chosen candidate, produce several radically different interfaces and compare them. Uses the vocabulary in [SKILL.md](SKILL.md).

## 1. Frame the problem

Write, for the person: the constraints any new interface must satisfy, the dependencies it relies on and their category ([DEEPENING.md](DEEPENING.md)), and a rough code sketch that makes the constraints concrete (not a proposal). Show it and carry on; they read while the designs are drafted.

## 2. Draft the designs

Spawn 3 or more subagents in parallel, one design each; without subagents, draft them yourself one after another, finishing each before starting the next. Give each a technical brief (file paths, coupling, dependency category, what sits behind the seam), the vocabulary from [SKILL.md](SKILL.md) and the project's own glossary (`CONTEXT.md` or similar, if it has one), and a different constraint:

- Minimise the interface: 1–3 entry points, maximum leverage per entry point.
- Maximise flexibility: many use cases and extension.
- Make the most common caller's case trivial.
- (When a dependency crosses a seam) design around ports and adapters.

Each design gives: the interface (types, methods, params, plus invariants, ordering, error modes); a usage example; what it hides behind the seam; its dependency strategy and adapters; its trade-offs.

## 3. Compare and recommend

Present the designs one at a time, then compare them in prose on **depth**, **locality** and **seam placement**. End with your recommendation and why; propose a hybrid when parts combine well. Be opinionated: the person wants a strong read, not a menu.
