---
name: norn-codebase-design
description: The deep-module vocabulary (module, interface, seam, adapter, depth) and its tests. Use when designing or restructuring a module's interface, judging whether a module is shallow, or deciding where a seam goes. Not for planning how a spec gets built; use norn-plan.
---

# Codebase Design

Without one vocabulary, design talk drifts ("component", "boundary", "API" for the same thing) and the usual mistakes slip through: a pass-through layer, a port with one adapter, tests that reach past the interface. Use these terms exactly, and judge a design by the tests below.

## Glossary

**Module**: anything with an interface and an implementation, at any scale: a function, a class, a package, a slice through several tiers. _Avoid_: unit, component, service.

**Interface**: everything a caller must know to use the module correctly: the type signature, plus invariants, ordering constraints, error modes, required configuration and performance characteristics. _Avoid_: API, signature (both name only the type-level surface).

**Implementation**: the code inside a module. Distinct from **adapter**: a small adapter can have a large implementation (a Postgres repository) and a large adapter a small one (an in-memory fake). Say "adapter" when the seam is the topic, "implementation" otherwise.

**Depth**: leverage at the interface: how much behaviour a caller (or test) can exercise per unit of interface it must learn. **Deep**: much behaviour behind a small interface. **Shallow**: the interface is nearly as complex as the implementation.

**Seam** _(Feathers)_: a place where behaviour can be altered without editing in that place; the location where a module's interface lives. Where the seam goes is its own decision, apart from what goes behind it. _Avoid_: boundary.

**Adapter**: a concrete thing that satisfies an interface at a seam. Names a role (the slot it fills), not its substance.

**Leverage**: what callers get from depth: more capability per unit of interface. One implementation pays back across N call sites and M tests.

**Locality**: what maintainers get from depth: change, bugs, knowledge and verification concentrate in one place. Fix once, fixed everywhere.

## Tests for a design

- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If it reappears across N callers, it earns its keep.
- **The locality test.** Name the last few changes in this area. If each touched several modules, the knowledge is spread and the seam is in the wrong place.
- **The interface is the test surface.** Callers and tests cross the same seam. A test that has to reach past the interface means the module is the wrong shape.
- **One adapter means a hypothetical seam; two mean a real one.** Introduce a port only when something varies across it, typically production and a test adapter. A one-adapter seam is just indirection.
- **Depth is a property of the interface.** A deep module may be built from small, swappable parts with **internal seams** its own tests use; they stay out of its interface.

When shaping an interface, ask: can it have fewer entry points, simpler parameters, more hidden inside?

## Rejected framings

- **Depth as the ratio of implementation lines to interface lines** (Ousterhout): rewards padding. Depth here is leverage.
- **Interface as the TypeScript `interface` keyword or a class's public methods**: too narrow; the interface is every fact a caller must know.
- **Boundary**: overloaded with DDD's bounded context. Say seam or interface.

## Going deeper

- **Deepening a cluster given its dependencies**: [DEEPENING.md](DEEPENING.md), the four dependency categories and replace-don't-layer testing.
- **Exploring alternative interfaces**: [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md), several radically different designs, compared on depth, locality and seam placement, with a recommendation.

Done when the design question is answered in these terms: the module, its interface, where its seam sits, and what depth it buys callers and tests.
