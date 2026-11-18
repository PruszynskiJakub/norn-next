# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. Uses the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **seam**, **adapter**.

## Dependency categories

Classify each dependency of the candidate. The category decides how the deepened module is tested across its seam.

1. **In-process.** Pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test through the new interface directly. No adapter.
2. **Local-substitutable.** A local stand-in exists (PGLite for Postgres, an in-memory or temp-dir filesystem, a real git repo in a temp dir). Deepenable if the stand-in exists; tests run it. The seam stays internal: no port at the module's interface.
3. **Remote but owned (ports and adapters).** Your own services across a network or process boundary. Define a **port** at the seam; the deep module owns the logic and the transport is an injected **adapter**. Tests use an in-memory adapter, production the real one.
4. **True external (mock).** Third-party services you don't control. The deepened module takes the dependency as an injected port; tests provide a fake adapter.

Before adding a port, look for one the code already has: a second adapter on an existing port is cheaper than a new seam.

## Testing strategy: replace, don't layer

- Write new tests at the deepened module's interface. Tests assert on what a caller can observe through it, never on internal state.
- Old tests on the shallow modules become waste once the interface tests cover the behaviour they covered: delete them then, not before. A test that is the only one covering a behaviour stays until its replacement goes red and green.
- A test that has to change when only the implementation changed is testing past the interface.
