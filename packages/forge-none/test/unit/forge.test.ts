/** Forge "none" beyond the shared contract: merges seen in git, the local record, and its failures. */
import { describe, expect, test } from "bun:test";
import { failureOf, memoryFiles, valueOf } from "@norn/conformance";
import { createForge, type ForgeEffect, PLUGIN_API_VERSION } from "@norn/plugin-api";
import { forgeNonePlugin, noneForgeFactory } from "../../src/index.ts";
import { noneForge } from "../../src/forge.ts";
import { encode, recordPath } from "../../src/record.ts";
import { gitRepo } from "./world.ts";

const openLogin: ForgeEffect = { kind: "open", head: "lt-1-login", base: "main", title: "Add login", body: "", draft: true };

function setup() {
  const repo = gitRepo();
  const forge = noneForge(repo.ctx);
  const find = async (b: string) => valueOf(await forge.findChanges([b]))[b] ?? null;
  return { repo, forge, find };
}

describe("forge none: merges are read from git", () => {
  test("a head merged into the base is merged, with the base tip as merge_sha and the time first seen", async () => {
    const { repo, forge, find } = setup();
    repo.branch("lt-1-login");
    const { change } = valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    expect(change.state).toBe("open");
    const mergeSha = repo.merge("lt-1-login", "main", "b".repeat(40));
    const merged = await find("lt-1-login");
    expect(merged).toMatchObject({ id: change.id, state: "merged", merge_sha: mergeSha });
    const seenAt = merged?.merged_at;
    repo.commit("main");
    repo.remove("lt-1-login");
    expect(await find("lt-1-login")).toMatchObject({ state: "merged", merge_sha: mergeSha, merged_at: seenAt, head_sha: change.head_sha });
    expect((await repo.record(change.id)).merged_at).toBe(seenAt as string);
  });

  test("a fast-forward merge counts: the head's commit is in the base", async () => {
    const { repo, forge, find } = setup();
    repo.branch("lt-1-login");
    valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    const tip = repo.merge("lt-1-login", "main");
    expect(await find("lt-1-login")).toMatchObject({ state: "merged", merge_sha: tip });
  });

  test("a head with no commits beyond the base when opened has merged nothing, until it gains one", async () => {
    const { repo, forge, find } = setup();
    repo.merge("main", "lt-1-login");
    valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    expect((await find("lt-1-login"))?.state).toBe("open");
    repo.commit("lt-1-login");
    expect((await find("lt-1-login"))?.state).toBe("open");
    repo.merge("lt-1-login", "main");
    expect((await find("lt-1-login"))?.state).toBe("merged");
  });

  test("the head's current commit is reported, and the last known one once the branch is gone", async () => {
    const { repo, forge, find } = setup();
    const first = repo.branch("lt-1-login");
    valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    const second = repo.commit("lt-1-login");
    expect((await find("lt-1-login"))?.head_sha).toBe(second);
    repo.remove("lt-1-login");
    expect(await find("lt-1-login")).toMatchObject({ state: "open", head_sha: first });
  });

  test("git runs in the repo root", async () => {
    const { repo, forge } = setup();
    repo.branch("lt-1-login");
    valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    expect(repo.exec.calls.length).toBeGreaterThan(0);
    for (const c of repo.exec.calls) expect({ git: c.argv[0], cwd: c.opts.cwd }).toEqual({ git: "git", cwd: "/repo" });
  });
});

describe("forge none: effects", () => {
  test("open writes one record under the machine folder, and its receipt replays it", async () => {
    const { repo, forge } = setup();
    const head = repo.branch("lt-1-login");
    const first = valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    expect(Object.keys(repo.files.snapshot())).toEqual(["/machine/repo/changes/1.json"]);
    expect(await repo.record(1)).toMatchObject({ id: 1, head_branch: "lt-1-login", head_sha: head, base_sha_at_open: repo.tip("main"), receipts: ["r1"], draft: true });
    const again = valueOf(await forge.perform({ ...openLogin, title: "other" }, { receipt_id: "r1" }));
    expect(again).toEqual({ ...first, replayed: true });
    expect(Object.keys(repo.files.snapshot())).toHaveLength(1);
  });

  test("ids go past the highest record, and past one a racing writer took", async () => {
    const { repo, forge } = setup();
    repo.branch("lt-1-login");
    valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    await repo.files.write("/machine/repo/changes/5.json", encode({ ...(await repo.record(1)), id: 5, receipts: ["r5"] }));
    expect(valueOf(await forge.perform(openLogin, { receipt_id: "r2" })).change.id).toBe(6);
    // a writer that created 7 after this one listed the folder: the exclusive create steps past it
    const raced = memoryFiles(repo.files.snapshot());
    const hiding = { ...raced, list: async () => [] as string[] };
    await raced.write("/machine/repo/changes/1.json", encode(await repo.record(1)));
    const forge2 = noneForge({ ...repo.ctx, files: hiding });
    expect(valueOf(await forge2.perform(openLogin, { receipt_id: "r3" })).change.id).toBe(2);
  });

  test("open on a branch that does not exist is not_found and writes nothing", async () => {
    const { repo, forge } = setup();
    expect(failureOf(await forge.perform(openLogin, { receipt_id: "r1" })).code).toBe("not_found");
    repo.branch("lt-1-login");
    expect(failureOf(await forge.perform({ ...openLogin, base: "trunk" }, { receipt_id: "r1" })).code).toBe("not_found");
    expect(failureOf(await forge.perform({ ...openLogin, head: "--all" }, { receipt_id: "r1" })).code).toBe("invalid");
    expect(repo.files.snapshot()).toEqual({});
  });

  test("a base branch the clone holds only as the remote's copy is opened against, and merges into it are seen", async () => {
    const { repo, forge, find } = setup();
    const develop = repo.branch("refs/remotes/origin/develop");
    repo.branch("lt-1-login", "refs/remotes/origin/develop");
    const { change } = valueOf(await forge.perform({ ...openLogin, base: "develop" }, { receipt_id: "r1" }));
    expect(await repo.record(change.id)).toMatchObject({ base_branch: "develop", base_sha_at_open: develop });
    expect(change.state).toBe("open");
    const mergeSha = repo.merge("lt-1-login", "refs/remotes/origin/develop", "c".repeat(40));
    expect(await find("lt-1-login")).toMatchObject({ state: "merged", merge_sha: mergeSha });
  });

  test("update edits the title and body, and replays by receipt without a second edit", async () => {
    const { repo, forge } = setup();
    repo.branch("lt-1-login");
    const { change } = valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    const u = valueOf(await forge.perform({ kind: "update", id: change.id, title: "New", body: "Body" }, { receipt_id: "r2" }));
    expect(u).toMatchObject({ replayed: false, change: { title: "New" } });
    expect(await repo.record(change.id)).toMatchObject({ title: "New", body: "Body", receipts: ["r1", "r2"] });
    expect(valueOf(await forge.perform({ kind: "update", id: change.id, title: "New" }, { receipt_id: "r2" })).replayed).toBe(true);
    expect((await repo.record(change.id)).receipts).toEqual(["r1", "r2"]);
  });

  test("ready on a merged change is a conflict and changes nothing", async () => {
    const { repo, forge } = setup();
    repo.branch("lt-1-login");
    const { change } = valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    repo.merge("lt-1-login", "main");
    expect(failureOf(await forge.perform({ kind: "ready", id: change.id }, { receipt_id: "r2" })).code).toBe("conflict");
    expect(await repo.record(change.id)).toMatchObject({ draft: true, receipts: ["r1"] });
  });

  test("a malformed effect is invalid", async () => {
    const { forge } = setup();
    expect(failureOf(await forge.perform({ kind: "merge", id: 1 } as unknown as ForgeEffect, { receipt_id: "r1" })).code).toBe("invalid");
  });
});

describe("forge none: failures", () => {
  test("a corrupt record fails the read rather than being skipped", async () => {
    const { repo, forge } = setup();
    await repo.files.write("/machine/repo/changes/1.json", "{not json");
    expect(failureOf(await forge.findChanges(["lt-1-login"])).code).toBe("invalid");
    await repo.files.write("/machine/repo/changes/1.json", '{"id":1}');
    expect(failureOf(await forge.findChanges(["lt-1-login"]))).toMatchObject({ code: "invalid", retryable: false });
  });

  test("a record whose id disagrees with its file name is invalid", async () => {
    const { repo, forge } = setup();
    repo.branch("lt-1-login");
    valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    await repo.files.write(recordPath(repo.ctx, 2), encode(await repo.record(1)));
    expect(failureOf(await forge.checks(2)).code).toBe("invalid");
  });

  test("git failing is a retryable failure, never read as unmerged", async () => {
    const { repo, forge } = setup();
    repo.branch("lt-1-login");
    valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    repo.down(true);
    expect(failureOf(await forge.findChanges(["lt-1-login"]))).toMatchObject({ code: "unavailable", retryable: true });
  });

  test("checks and the checks report are none for a change, not_found for a missing one", async () => {
    const { repo, forge } = setup();
    repo.branch("lt-1-login");
    const { change } = valueOf(await forge.perform(openLogin, { receipt_id: "r1" }));
    expect(valueOf(await forge.checks(change.id))).toBe("none");
    expect(failureOf(await forge.checks(42)).code).toBe("not_found");
    expect(valueOf(await (forge.checkReport?.(change.id) ?? Promise.reject(new Error("no checkReport"))))).toEqual({ summary: "none", failed: [] });
    expect(failureOf(await (forge.checkReport?.(42) ?? Promise.reject(new Error("no checkReport")))).code).toBe("not_found");
  });
});

describe("forge none: plugin", () => {
  test("provides forge none against this plugin API", () => {
    expect(forgeNonePlugin.name).toBe("norn-forge-none");
    expect(forgeNonePlugin.provides.forge?.none).toBe(noneForgeFactory);
    expect(PLUGIN_API_VERSION.startsWith("1.")).toBe(true);
  });

  test("the host makes it from an empty config and refuses any other", () => {
    const { repo } = setup();
    const made = valueOf(createForge(noneForgeFactory, repo.ctx, {}));
    expect({ name: made.name, capabilities: made.capabilities }).toEqual({ name: "none", capabilities: { draft: true, checks: false, raw_urls: false } });
    expect(failureOf(createForge(noneForgeFactory, repo.ctx, { url: "x" })).code).toBe("invalid");
  });
});
