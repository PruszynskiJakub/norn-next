---
name: norn-diagnose
description: Diagnose a hard bug, a flaky test or a performance regression — build a tight, deterministic loop that goes red on the reported symptom, minimise it, rank falsifiable hypotheses, instrument and bisect until the cause is confirmed, then fix behind a regression test (or hand the loop and cause over when told not to fix). Never hypothesise without a loop that has gone red. Use when asked to diagnose, debug or reproduce something broken, throwing, failing, intermittent or slow, or when a failure does not reproduce on the first try.
---

# Diagnose

A discipline for bugs that resist a first look. Do the phases in order; skip one only when you can say why.

Read the project's glossary or `CONTEXT.md` (if it exists) so you name modules the way the project does, and respect ADRs in the area you touch.

## Redact

You will show commands, output and captured artifacts. **Redact every secret first**: write `<REDACTED>` in its place. Build loops on environment variables so credentials stay in the environment, never in what you show. Captured requests carry auth headers: quote only the lines that carry the signal. If the redacted output is not enough to diagnose, say so and ask.

## 1. Build a loop

**This is the skill.** A tight pass/fail signal that goes red on *this* bug makes the cause findable; bisecting, hypotheses and instrumentation only consume it. Without one, reading code will not save you. Spend most of your effort here, and do not give up early.

Ways to build one, roughly in this order:

1. A **failing test** at whatever seam reaches the bug: unit, integration, end-to-end.
2. An **HTTP script** (`curl`) against a running dev server.
3. A **CLI run** on a fixture input, diffing its output against a known-good snapshot.
4. A **headless browser script** (Playwright, Puppeteer) asserting on DOM, console or network.
5. A **replayed capture**: save a real request, payload or event log to disk and replay it through the code path alone.
6. A **throwaway harness**: the smallest part of the system (one service, faked dependencies) that drives the bug's code path with one call.
7. A **property or fuzz loop**: for "sometimes wrong", run a thousand random inputs and look for the failure.
8. A **bisection harness**: when the bug appeared between two known states (commit, dataset, version), automate "set up state X, check" so `git bisect run` can drive it.
9. A **differential loop**: the same input through the old and new version (or two configs), outputs diffed.
10. A **person in the loop**, last resort: when someone must click, drive them with a copy of `scripts/hitl-loop.template.sh` so the loop stays structured and their answers come back to you.

**Tighten it.** Treat the loop as a product:

- faster: cache setup, skip unrelated init, narrow the test scope;
- sharper: assert the exact symptom, not "didn't crash";
- deterministic: pin time, seed randomness, isolate the filesystem, freeze the network.

A 30-second flaky loop is barely a loop; a 2-second deterministic one finds the cause.

**Flaky, timing or CI-only failures.** The goal is a higher reproduction rate, not a clean repro. Run the trigger a hundred times, in parallel, under load; narrow timing windows; inject sleeps; match the CI environment (versions, env vars, parallelism, a clean checkout). At 50% a bug is debuggable, at 1% it is not: keep raising the rate.

**When you cannot build one**, stop and say so. List what you tried, and ask for access to an environment that reproduces it, a redacted capture (HAR, log dump, core dump, a timed screen recording), or permission to add temporary instrumentation where it happens. Never go on to hypothesise.

**Done when** you can name **one command** (a script, a test invocation, a request) that you have **already run** (show it and its redacted output) and that is:

- [ ] **red-capable**: it drives the real code path and asserts the user's exact symptom, so it goes red on this bug and green once fixed;
- [ ] **deterministic**: the same verdict every run (flaky: a pinned, high rate);
- [ ] **fast**: seconds, not minutes;
- [ ] **unattended**: you run it alone; a person only through the template script.

Reading code to build a theory before that command exists is the exact failure this skill prevents. No red loop, no phase 2.

## 2. Reproduce and minimise

Run the loop and watch it go red. Confirm:

- [ ] it shows the failure the user reported, not a nearby one: the wrong bug gets the wrong fix;
- [ ] it fails across runs (flaky: at a rate you can debug against);
- [ ] the exact symptom is captured (message, wrong output, timing), so a fix can be checked against it.

Then **shrink it** to the smallest scenario that still goes red: cut inputs, callers, config, data and user actions one at a time, re-running after each cut, keeping only what the failure needs. A minimal repro leaves fewer suspects and becomes a clean regression test. Done when removing any remaining part turns the loop green.

## 3. Hypothesise

Write **3–5 ranked hypotheses** before testing any. One hypothesis anchors on the first plausible idea.

Each must be **falsifiable**: "If X is the cause, then changing Y makes the bug disappear (or changing Z makes it worse)." A hypothesis without a prediction is a hunch: sharpen it or drop it.

Show the ranked list to a person when one is present: they often know what changed recently or what is already ruled out. Do not wait for them.

## 4. Instrument

Every probe tests one prediction from phase 3. **Change one variable at a time.**

1. A **debugger or REPL** when the environment has one: one breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that tell hypotheses apart.
3. Never log everything and grep.

**Tag every debug log** with one unique prefix (`[DEBUG-a4f2]`) so cleanup is a single grep.

**Performance regressions**: logs mislead. Measure a baseline first (a timing harness, a profiler, a query plan), then bisect. Measure, then fix.

Done when one hypothesis is confirmed: its prediction held in the loop, and the others' did not.

## Not fixing

When you are told not to fix, stop here. Remove the tagged instrumentation, keep the loop, and hand back:

- the loop command and its red output (redacted), and the minimised repro;
- the confirmed cause, with the evidence that confirmed it and the hypotheses ruled out;
- the seam where a regression test would catch the real bug pattern, or that no such seam exists (see phase 5).

## 5. Fix behind a regression test

Write the regression test **before the fix**, at a **correct seam**: one where the test exercises the real bug pattern as it occurs at the call site. A seam too shallow for the bug (one caller when the bug needs several, a unit that cannot replay the chain that triggered it) gives false confidence. **No correct seam is itself a finding**: say that the design keeps this bug from being locked down.

With a correct seam (the `norn-tdd` skill says what a good test there is):

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail for the right reason. If you forced red by changing code or a fixture, `diff` against a pristine copy to prove the change landed.
3. Fix the cause.
4. Watch it pass.
5. Re-run the phase 1 loop on the original, unminimised scenario.

## Rules

- No hypothesis without a loop that has gone red at least once.
- Fix the confirmed cause, not the symptom; one cause per fix.
- Commit locally; never push.

Done when the original loop no longer goes red; the regression test passes (or the missing seam is written down); no `[DEBUG-` tag is left (grep it); throwaway harnesses are deleted or kept in a clearly marked debug location; and the confirmed hypothesis is stated in the commit message (or in what you hand back, when told not to fix), so the next person to debug this learns from it.
