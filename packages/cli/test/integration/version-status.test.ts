/**
 * gh-61 B8, B5 (D5, D7): `norn status`, `status --segment` and the read model show a binary that
 * does not fit the repo's `norn_version` at the top of the inbox, and a hint when the repo records
 * none; the inbox the view shows equals `buildInbox` over observe's Facts.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rmSync } from "node:fs";
import { repoConfigPath } from "@norn/store";
import { createHarness, type Harness } from "../../../../test/support/harness.ts";
import { observeNow } from "../../../../test/support/observe-now.ts";
import { buildInbox } from "@norn/core";
import { Context } from "../../src/index.ts";
import { projectView } from "../../src/runtime/human.ts";

setDefaultTimeout(30_000);

const MISMATCH = "this repo needs norn 0.19.x (you run 0.18.1): install norn 0.19.x";
const NO_VERSION = "no norn version recorded: run `norn upgrade`";

type Groups = Record<string, Array<{ id: string; title: string; command: string }>>;
const groupsOf = (v: unknown) => (v as { groups: Groups }).groups;

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ version: "0.18.1" });
  expect((await h.norn("init")).exit).toBe(0);
});
afterAll(() => h.cleanup());

describe("the norn version in status (gh-61 B8, B5)", () => {
  test("B8: binary 0.18.1 in a repo at 0.19.0 → status exits 0 with the mismatch on top", async () => {
    h.config("norn_version: 0.19.0\n");
    const r = await h.norn("status");
    expect(r.exit).toBe(0);
    expect(r.stdout.split("\n")[0]).toContain(MISMATCH);
    expect(r.stdout.match(new RegExp(MISMATCH.replace(/[().]/g, "\\$&"), "g"))).toHaveLength(1);
    const json = await h.norn("status", "--json");
    expect(json.exit).toBe(0);
    expect(groupsOf(JSON.parse(json.stdout)).unblock?.[0]).toMatchObject({ title: MISMATCH, command: "norn doctor" });
  });

  test("B8: status --segment shows the mismatch in the tab bar line", async () => {
    const r = await h.norn("status", "--segment");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("this repo needs norn 0.19.x (you run 0.18.1)");
  });

  test("inbox parity holds on a mismatch: the view's inbox is buildInbox over observe's Facts", async () => {
    const obs = await observeNow(h);
    expect(obs.facts.norn).toEqual({ running: "0.18.1", repo: "0.19.0", skills_drift: [] });
    const ctx = new Context(h.deps);
    await ctx.locate();
    const observed = buildInbox(obs.facts, obs.config);
    expect((await projectView(ctx)).inbox).toEqual(observed);
    expect(observed.groups.unblock[0]?.title).toBe(MISMATCH);
  });

  test("B5: no norn_version recorded → status shows the hint as a Check item", async () => {
    rmSync(repoConfigPath(h.root), { force: true });
    const r = await h.norn("status", "--json");
    expect(r.exit).toBe(0);
    const groups = groupsOf(JSON.parse(r.stdout));
    expect(groups.unblock).toEqual([]);
    expect(groups.check?.map((i) => i.title)).toEqual([NO_VERSION]);
    expect((await h.norn("status")).stdout).toContain(NO_VERSION);
  });

  test("a matching version adds no item", async () => {
    h.config("norn_version: 0.18.0\n");
    const r = await h.norn("status", "--json");
    const groups = groupsOf(JSON.parse(r.stdout));
    expect(Object.values(groups).flat()).toEqual([]);
  });
});
