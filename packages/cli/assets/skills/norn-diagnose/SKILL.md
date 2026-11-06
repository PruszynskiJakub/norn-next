---
name: norn-diagnose
description: Finds the cause of a hard bug, flaky test or performance regression by first building a loop that goes red on it, then fixes it behind a regression test or hands the cause back. Use when asked to diagnose or debug a failure. Not for QA against criteria; use norn-qa.
---

# Diagnose

Without this, an agent reads code, picks the first plausible theory and fixes a bug it never saw fail. Do the phases in order; skip one only when you can say why.

**Redact first.** Everything you show (commands, output, captures) may be posted to an issue: write `<REDACTED>` for every secret, keep credentials in environment variables the loop reads, and quote only the lines of a captured request that carry the signal.

## 1. Build a loop

**This is the skill.** Spend most of your effort here; bisecting, hypotheses and probes only consume the loop. In rough order of preference:

- a failing test at whatever seam reaches the bug;
- a `curl` script, a CLI run on a fixture diffed against a known-good output, or a headless browser script;
- a replayed capture (a saved request, payload or event log) through the code path alone;
- a throwaway harness: the smallest part of the system, dependencies faked, driving the path with one call;
- a property or fuzz loop for "sometimes wrong";
- a bisection harness `git bisect run` can drive, when the bug appeared between two known states;
- a differential loop: the same input through the old and new version, outputs diffed;
- last resort, a person in the loop: copy `scripts/hitl-loop.template.sh` outside the repository and run it. Only with a person at the terminal: in an unattended session its prompts wait forever.

**Tighten it**: faster (cache setup, narrow the scope), sharper (assert the exact symptom, not "didn't crash"), deterministic (pin time, seed randomness, isolate the filesystem, freeze the network).

**Flaky, timing or CI-only**: aim for a higher reproduction rate, not a clean repro. Run it a hundred times, in parallel, under load; inject sleeps; match CI (versions, env vars, parallelism, a clean checkout). At 50% a bug is debuggable, at 1% it is not.

**Done when** you have **one command you have already run** (show it and its redacted output) that is:

- [ ] **red on this bug**: it drives the real code path and asserts the user's exact symptom, not a nearby failure (the wrong bug gets the wrong fix), and would go green once fixed;
- [ ] **deterministic**: the same verdict every run (flaky: a pinned rate you can debug against);
- [ ] **fast and unattended**: seconds, run by you alone.

**When you cannot build one**, stop: list what you tried and what would let you (an environment that reproduces it, a redacted capture, permission to instrument where it happens). That list is your hand-back. No red loop, no hypotheses.

## 2. Minimise

Cut inputs, callers, config, data and user actions one at a time, re-running after each cut. Done when removing any remaining part turns the loop green. The minimal repro is the regression test to come.

## 3. Hypothesise

Write **3–5 ranked hypotheses** before testing any; one anchors on the first idea. Each is **falsifiable**: "if X is the cause, changing Y makes the bug go away (or Z makes it worse)". No prediction, no hypothesis. Show the list to a person when one is present; do not wait for them.

## 4. Instrument

Each probe tests one prediction; **change one variable at a time**. A debugger or REPL beats logs; logs go at the boundaries that tell hypotheses apart, never everywhere. **Tag every debug log** with one unique prefix (`[DEBUG-a4f2]`) so cleanup is one grep. For a performance regression, measure a baseline first (timing harness, profiler, query plan), then bisect.

Done when one hypothesis's prediction held in the loop and the others' did not.

## Not fixing

When told not to fix, stop here, remove the tagged instrumentation and hand back:

- the loop command and its red output, and the minimised repro;
- the confirmed cause (`file:line`) with the evidence and the hypotheses ruled out, or, when none was confirmed, the ranked ones left and what each probe showed;
- the seam where a regression test would catch the real bug pattern, or that none exists (phase 5).

## 5. Fix behind a regression test

Pick a **correct seam**: one where a test replays the bug as it occurs at the call site. A seam too shallow (one caller when the bug needs several) gives false confidence; **no correct seam is itself a finding**: say the design keeps this bug from being locked down.

1. Turn the minimised repro into a test at that seam (the `norn-tdd` skill says what a good one is) and watch it fail for the right reason.
2. Fix the confirmed cause, not the symptom; one cause per fix.
3. Watch the test pass, then re-run the phase 1 loop on the original, unminimised scenario.

Done when the original loop no longer goes red, the regression test passes (or the missing seam is written down), `grep -r '\[DEBUG-'` finds nothing, throwaway harnesses are deleted, and the confirmed hypothesis is in the commit message (or in your hand-back). Never push.
