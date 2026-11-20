import { describe, expect, test } from "bun:test";
import { type CountedStep, DEFAULT_COUNTER_DEFAULTS, deriveCounters, type ExitLeft, type Route } from "../../src/index.ts";

const step = (kind: string, routes: Record<string, Route>, exits?: Record<string, string>): CountedStep => ({ kind, routes, ...(exits && { exits }) });
const derive = (steps: Record<string, CountedStep>, exits: Record<string, ExitLeft> = {}, declared = {}) =>
  deriveCounters(steps, Object.keys(steps), declared, exits, DEFAULT_COUNTER_DEFAULTS);

describe("deriveCounters", () => {
  test("each kind of route back gets its default bound", () => {
    const d = derive({
      build: step("agent", { done: "test" }),
      test: step("check", { pass: "ok", fail: "build", flaky: "build" }, { 4: "flaky" }),
      ok: { ...step("gate", { approve: "land", reject: "build", stale: "build" }), signals: ["stale"] },
      land: step("integrate", { done: "$done", conflict: "build" }),
    });
    expect(d.errors).toEqual([]);
    expect(d.counters).toEqual({
      "test.fail": { max: 5, reset_on: [] },
      "test.flaky": { max: 5, reset_on: [] },
      "ok.reject": { max: 2, reset_on: [] },
      "ok.stale": { max: 10, reset_on: [] },
      "land.conflict": { max: 2, reset_on: ["land.done"] },
    });
  });

  test("an agent's route back counts only where no other counter already bounds the loop", () => {
    const d = derive({
      build: step("agent", { done: "test" }),
      test: step("check", { pass: "review", fail: "build" }),
      review: step("agent", { approve: "$done", changes_requested: "build", rethink: "review" }),
    });
    expect(d.edges).toEqual({ "test.fail": "test.fail", "review.changes_requested": "review.changes_requested", "review.rethink": "review.rethink" });
    const counted = derive({
      build: step("agent", { done: "test" }),
      test: step("check", { pass: { to: "review", max: 1 }, fail: "build" }),
      review: step("agent", { approve: "$done", changes_requested: "build" }),
    });
    expect(Object.keys(counted.edges)).toEqual(["test.pass", "test.fail"]);
  });

  test("a route's max replaces the default bound and keeps a conflict's resets", () => {
    const d = derive({ land: step("integrate", { done: "$done", conflict: { to: "fix", max: 7 } }), fix: step("agent", { done: "land" }) });
    expect(d.counters["land.conflict"]).toEqual({ max: 7, reset_on: ["land.done"] });
  });

  test("routes leaving one shared exit share one counter named after it", () => {
    const steps = { a: step("check", { pass: "b", fail: "fix" }), b: step("check", { pass: "$done", fail: "fix" }), fix: step("agent", { done: "a" }) };
    const exit = { exit: "tests.broken" };
    const d = derive(steps, { "a.fail": exit, "b.fail": exit });
    expect(d.edges).toEqual({ "a.fail": "tests.broken", "b.fail": "tests.broken" });
    expect(d.counters).toEqual({ "tests.broken": { max: 5, reset_on: [] } });
  });

  test("a shared exit fed by routes of different kinds needs max: on the use route", () => {
    const steps = { t: step("check", { pass: "$done", fail: "fix" }), g: step("gate", { approve: "t", reject: "fix" }), fix: step("agent", { done: "g" }) };
    const exit = { exit: "ship.back" };
    const d = derive(steps, { "t.fail": exit, "g.reject": exit });
    expect(d.errors).toEqual([
      { path: "/steps/ship/outcomes/back", message: "exit `back` of `ship` is fed by edges of different kinds (check fail: `t.fail`; gate reject: `g.reject`): give max: on `ship`'s route" },
    ]);
    const bounded = derive(steps, { "t.fail": { ...exit, max: 4 }, "g.reject": { ...exit, max: 4 } });
    expect(bounded.errors).toEqual([]);
    expect(bounded.counters).toEqual({ "ship.back": { max: 4, reset_on: [] } });
  });

  test("max: with a counter, max: on a route that ends the run, and an undeclared counter are refused", () => {
    const d = derive({
      a: step("agent", { done: { to: "$done", max: 2 }, back: { to: "a", counter: "loop", max: 2 }, other: { to: "a", counter: "nope" } }),
    }, {}, { loop: { max: 3 } });
    expect(d.errors).toEqual([
      { path: "/steps/a/outcomes/done", message: "`a.done` → `$done` sets max, but there is no loop to bound" },
      { path: "/steps/a/outcomes/back", message: "`a.back` sets both max and counter: a named counter's max goes under counters" },
      { path: "/steps/a/outcomes/other", message: "counter 'nope' is not declared in counters" },
    ]);
  });

  test("declared counters come back with their resets as a list", () => {
    const d = derive({ a: step("agent", { done: "$done", back: { to: "a", counter: "loop" } }) }, {}, { loop: { max: 3, reset_on: "a.done" } });
    expect(d.counters).toEqual({ loop: { max: 3, reset_on: ["a.done"] } });
    expect(d.edges).toEqual({});
  });
});
