/**
 * The argv the refs store hands git, on a scripted exec: which refs it names, how it pushes under
 * a lease, and how it tells a lost lease from an unreachable remote. Real git behaviour is proven by
 * the store contract in test/integration/.
 */
import { describe, expect, test } from "bun:test";
import { manualClock, memoryHost, type ScriptedAnswer, scriptedExec } from "@norn/conformance";
import { createStore, type PluginResult, storeProblems } from "@norn/plugin-api";
import {
  claimRef,
  createRefsStore,
  mailboxRef,
  parseCatFileBatch,
  REFS_NAMESPACE,
  type RefsStoreConfig,
  refsStoreFactory,
  refsStorePlugin,
  runRef,
  trackingRunRef,
} from "../../src/index.ts";

const OID = (c: string) => c.repeat(40);
const TREE = OID("e");
const COMMIT = OID("c");
const BLOB = OID("b");

/** git's argv without the `-c key=value` settings the store always passes. */
function gitArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "-c") i++;
    else out.push(argv[i] as string);
  }
  return out;
}

type GitScript = (args: string[], input: string | undefined) => ScriptedAnswer | undefined;

/** A fake git: plumbing that writes objects answers fixed ids, the rest is up to `script`. */
function world(script: GitScript, config: RefsStoreConfig = {}) {
  const exec = scriptedExec((argv, opts) => {
    if (argv[0] !== "git") return undefined;
    const args = gitArgs(argv);
    const scripted = script(args, opts.input);
    if (scripted) return scripted;
    if (args[0] === "hash-object") return { stdout: `${BLOB}\n` };
    if (args[0] === "mktree") return { stdout: `${TREE}\n` };
    if (args[0] === "commit-tree") return { stdout: `${COMMIT}\n` };
    return undefined;
  });
  const clock = manualClock("2026-11-17T10:00:00.000Z");
  const ctx = memoryHost({ exec, now: clock.now, repo: { root: "/repo", dataDir: "/machine/repo" } });
  return { store: createRefsStore(ctx, config), exec, args: () => exec.calls.map((c) => gitArgs(c.argv)) };
}

function code<T>(r: PluginResult<T>): string | null {
  return r.ok ? null : r.failure.code;
}

describe("argv shape", () => {
  test("acquire reads the remote ref, then pushes the new claim atomically under a lease that it must not exist", async () => {
    const w = world((args) => (args[0] === "ls-remote" ? { stdout: "" } : args[0] === "push" ? { stdout: `To remote\n*\t${COMMIT}:refs/norn/v2/claims/gh-12\t[new reference]\nDone\n` } : undefined));
    const r = await w.store.claims.acquire("gh-12", "machine-a", 60_000);
    expect(r.ok).toBe(true);
    expect(w.args().map((a) => a[0])).toEqual(["ls-remote", "hash-object", "mktree", "commit-tree", "push"]);
    expect(w.args()[0]).toEqual(["ls-remote", "--refs", "origin", "refs/norn/v2/claims/gh-12"]);
    expect(w.args().at(-1)).toEqual([
      "push",
      "--atomic",
      "--porcelain",
      "--no-verify",
      "origin",
      `${COMMIT}:refs/norn/v2/claims/gh-12`,
      "--force-with-lease=refs/norn/v2/claims/gh-12:",
    ]);
    expect(w.exec.calls.every((c) => c.opts.cwd === "/repo")).toBe(true);
  });

  test("the configured remote is the one read and pushed to", async () => {
    const w = world((args) => (args[0] === "ls-remote" ? { stdout: "" } : args[0] === "push" ? { stdout: "" } : undefined), { remote: "team" });
    await w.store.mailbox?.send("gh-3", { id: "m-1", from: "person", data: {} });
    const remoteCalls = w.args().filter((a) => a[0] === "ls-remote" || a[0] === "push");
    expect(remoteCalls.map((a) => a.includes("team") && !a.includes("origin"))).toEqual([true, true]);
  });

  test("run data moves the local ref by update-ref against the commit it read", async () => {
    const w = world((args) => (args[0] === "rev-parse" ? { code: 1, stdout: "" } : args[0] === "update-ref" ? { stdout: "" } : undefined));
    expect(await w.store.appendReceipt("gh-12/03", { id: "r1", data: { n: 1 } })).toEqual({ ok: true, value: { seq: 1, replayed: false } });
    expect(w.args()[0]).toEqual(["rev-parse", "-q", "--verify", "refs/norn/v2/runs/gh-12^{commit}"]);
    expect(w.args().at(-1)).toEqual(["update-ref", "refs/norn/v2/runs/gh-12", COMMIT, ""]);
    const hashed = w.exec.calls.find((c) => gitArgs(c.argv)[0] === "hash-object");
    expect(JSON.parse(hashed?.opts.input ?? "")).toEqual({ seq: 1, id: "r1", at: "2026-11-17T10:00:00.000Z", data: { n: 1 } });
    const mktrees = w.exec.calls.filter((c) => gitArgs(c.argv)[0] === "mktree").map((c) => c.opts.input);
    expect(mktrees[0]).toBe(`100644 blob ${BLOB}\t1-r1.json\0`);
  });

  test("flush pushes the local run ref under a lease on the tracking ref", async () => {
    const local = OID("1");
    const seen = OID("2");
    const w = world((args) => {
      if (args[0] === "rev-parse") return { stdout: `${args[3]?.startsWith("refs/norn/v2/runs/") ? local : seen}\n` };
      if (args[0] === "merge-base") return { code: args[2] === seen ? 0 : 1 };
      if (args[0] === "push" || args[0] === "update-ref") return { stdout: "" };
      return undefined;
    });
    expect(await w.store.flush?.("gh-12")).toEqual({ ok: true, value: { pushed: true } });
    expect(w.args().find((a) => a[0] === "push")).toEqual([
      "push",
      "--atomic",
      "--porcelain",
      "--no-verify",
      "origin",
      `${local}:refs/norn/v2/runs/gh-12`,
      `--force-with-lease=refs/norn/v2/runs/gh-12:${seen}`,
    ]);
    expect(w.args().at(-1)).toEqual(["update-ref", "refs/norn/v2/tracking/runs/gh-12", local, seen]);
  });

  test("sync fetches only the new namespace's run refs into tracking refs", async () => {
    const w = world((args) => (args[0] === "for-each-ref" || args[0] === "fetch" ? { stdout: "" } : undefined));
    expect(await w.store.sync?.()).toEqual({ ok: true, value: { fetched: 0 } });
    expect(w.args().find((a) => a[0] === "fetch")).toEqual([
      "fetch",
      "--no-write-fetch-head",
      "--no-tags",
      "--quiet",
      "--prune",
      "origin",
      "+refs/norn/v2/runs/*:refs/norn/v2/tracking/runs/*",
    ]);
  });

  test("every ref the store names is in refs/norn/v2, a slice never in a ref name", async () => {
    const w = world((args) => (["rev-parse"].includes(args[0] as string) ? { code: 1 } : ["ls-remote", "push", "update-ref", "for-each-ref", "fetch"].includes(args[0] as string) ? { stdout: "" } : undefined));
    const st = w.store;
    await st.readUnit("gh-12/03");
    await st.appendReceipt("gh-12/03", { id: "r1", data: {} });
    await st.commitState("gh-12/03", {}, null);
    await st.listUnits();
    await st.claims.acquire("gh-12", "a", 1_000);
    await st.mailbox?.send("gh-12", { id: "m", from: "p", data: {} });
    await st.artifacts?.write("gh-12", "spec.md", "x");
    await st.archive("gh-12");
    await st.sync?.();
    const named = w.args().flatMap((a) => a.flatMap((x) => x.match(/refs\/[^\s:^]*/g) ?? []));
    expect(named.length).toBeGreaterThan(0);
    for (const ref of named) expect({ ref, ok: ref.startsWith("refs/norn/v2/") && !ref.includes("gh-12/03") }).toEqual({ ref, ok: true });
  });
});

test("every ref kind sits under the new namespace, one ref per story", () => {
  expect([runRef("gh-12"), trackingRunRef("gh-12"), claimRef("gh-12"), mailboxRef("gh-12")]).toEqual(
    ["runs", "tracking/runs", "claims", "mailbox"].map((kind) => `${REFS_NAMESPACE}/${kind}/gh-12`),
  );
});

describe("a lost lease and an unreachable remote", () => {
  test("a rejected push reads again, and a claim then held by another is a conflict", async () => {
    const theirs = OID("9");
    const claim = JSON.stringify({ story: "gh-12", holder: "machine-b", acquired_at: "2026-11-17T10:00:00.000Z", expires_at: "2026-11-17T11:00:00.000Z", version: 1 });
    let pushed = false;
    const w = world((args, input) => {
      if (args[0] === "ls-remote") return { stdout: pushed ? `${theirs}\trefs/norn/v2/claims/gh-12\n` : "" };
      if (args[0] === "push") {
        pushed = true;
        return { code: 1, stdout: `To remote\n!\t${COMMIT}:refs/norn/v2/claims/gh-12\t[rejected] (stale info)\nDone\n` };
      }
      if (args[0] === "cat-file" && args[1] === "-e") return { code: 0 };
      if (args[0] === "ls-tree") return { stdout: `100644 blob ${BLOB}\tclaim.json\0` };
      if (args[0] === "cat-file" && input === `${BLOB}\n`) return { stdout: `${BLOB} blob ${Buffer.byteLength(claim)}\n${claim}\n` };
      return undefined;
    });
    expect(code(await w.store.claims.acquire("gh-12", "machine-a", 60_000))).toBe("conflict");
    expect(w.args().filter((a) => a[0] === "push")).toHaveLength(1);
  });

  test("a push refused for any other reason is unavailable, never mistaken for a lost race", async () => {
    const w = world((args) => (args[0] === "ls-remote" ? { stdout: "" } : args[0] === "push" ? { code: 128, stderr: "fatal: could not read from remote repository" } : undefined));
    const r = await w.store.claims.acquire("gh-12", "machine-a", 60_000);
    expect(r.ok ? null : { code: r.failure.code, retryable: r.failure.retryable }).toEqual({ code: "unavailable", retryable: true });
  });

  test("malformed input is refused before git runs", async () => {
    const w = world(() => undefined);
    const st = w.store;
    const answers: Array<PluginResult<unknown> | undefined> = [
      await st.readUnit("GH-1"),
      await st.appendReceipt("gh-1", { id: "../x", data: {} }),
      await st.commitState("gh-1", undefined, null),
      await st.claims.acquire("gh-1/02", "a", 1_000),
      await st.claims.acquire("gh-1", "a", 1.5),
      await st.mailbox?.send("gh-1", { id: "m", from: "", data: {} }),
      await st.artifacts?.write("gh-1", "../escape.md", "x"),
      await st.flush?.("gh-1/02"),
    ];
    expect(answers.map((r) => (r ? code(r) : "missing"))).toEqual(Array(answers.length).fill("invalid"));
    expect(w.exec.calls).toEqual([]);
  });
});

describe("cat-file --batch output", () => {
  test("is sliced by byte size, so multi-byte text, CRLF and NUL come back whole", () => {
    const a = "zażółć 🧵\r\n\0end";
    const b = "plain";
    const out = `${OID("a")} blob ${Buffer.byteLength(a)}\n${a}\n${OID("b")} blob ${b.length}\n${b}\n`;
    expect(parseCatFileBatch(out, [OID("a"), OID("b")])).toEqual(
      new Map([
        [OID("a"), a],
        [OID("b"), b],
      ]),
    );
  });

  test("a missing object, a wrong size or a cut answer is reported, never half-read", () => {
    expect(parseCatFileBatch(`${OID("a")} missing\n`, [OID("a")])).toBeTypeOf("string");
    expect(parseCatFileBatch(`${OID("a")} blob 3\nabcdef\n`, [OID("a")])).toBeTypeOf("string");
    expect(parseCatFileBatch(`${OID("a")} blob 10\nabc`, [OID("a")])).toBeTypeOf("string");
  });
});

describe("plugin", () => {
  test("provides store refs, whose store passes the shape check and validates its config", () => {
    expect(Object.keys(refsStorePlugin.provides.store ?? {})).toEqual(["refs"]);
    const ctx = memoryHost();
    const made = createStore(refsStoreFactory, ctx, { remote: "team" });
    expect(made.ok && storeProblems(made.value)).toEqual([]);
    expect(made.ok && made.value.capabilities).toEqual({ shared: true, claims: "distributed", mailbox: true, artifacts: true });
    expect(code(createStore(refsStoreFactory, ctx, { remote: "--upload-pack=evil" }))).toBe("invalid");
    expect(code(createStore(refsStoreFactory, ctx, { branch: "x" }))).toBe("invalid");
  });
});
