/** Store "local" beyond the shared contract: where its files go, corrupt records, the lock under every write, and its plugin. */
import { describe, expect, test } from "bun:test";
import { failureOf, memoryFiles, memoryHost, valueOf } from "@norn/conformance";
import { createStore, type HostFiles, type PluginResult, type Store, type StoreArtifacts, type StoreMailbox, storeProblems } from "@norn/plugin-api";
import { createLocalStore, encodeArtifactName, localStorePlugin, PLUGIN_NAME } from "../../src/index.ts";
import { localStoreWorld, RUNS } from "./world.ts";

const STORY = `${RUNS}/stories/gh-12`;
const OWN = `${STORY}/units/story`;
const SLICE = `${STORY}/units/03`;
const receiptFile = (dir: string, seq: number, id: string) => `${dir}/receipts/${String(seq).padStart(8, "0")}-${id}.json`;
const mailboxOf = (s: Store): StoreMailbox => {
  if (!s.mailbox) throw new Error("store local offers a mailbox");
  return s.mailbox;
};
const artifactsOf = (s: Store): StoreArtifacts => {
  if (!s.artifacts) throw new Error("store local offers artifacts");
  return s.artifacts;
};
const receiptText = (seq: number, id: string, data: unknown = {}) => JSON.stringify({ seq, id, at: "2026-11-17T10:00:00.000Z", data });

/**
 * Files as the default macOS and Windows file systems keep them: a name is found whatever its case
 * and Unicode normalization, and keeps the spelling it was first created with.
 */
function foldingFiles(): HostFiles & { snapshot(): Record<string, string> } {
  const key = (p: string) => p.normalize("NFC").toLowerCase();
  const files = new Map<string, { path: string; data: string }>();
  return {
    read: async (p) => files.get(key(p))?.data ?? null,
    write: async (p, data) => {
      files.set(key(p), { path: files.get(key(p))?.path ?? p, data });
    },
    create: async (p, data) => {
      if (files.has(key(p))) return false;
      files.set(key(p), { path: p, data });
      return true;
    },
    list: async (dir) => {
      const prefix = `${key(dir)}/`;
      const names = [...files.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"));
      return names.map(([, f]) => f.path.slice(f.path.lastIndexOf("/") + 1)).sort();
    },
    remove: async (p) => {
      files.delete(key(p));
    },
    snapshot: () => Object.fromEntries([...files.values()].map((f) => [f.path, f.data])),
  };
}

describe("layout", () => {
  test("a unit's receipts and state, a claim, a mailbox and artifacts land in the story's folder, and nothing else is left", async () => {
    const { store, files } = localStoreWorld();
    valueOf(await store.appendReceipt("gh-12", { id: "r-1", data: { n: 1 } }));
    valueOf(await store.commitState("gh-12/03", { step: "plan" }, null));
    valueOf(await store.claims.acquire("gh-12", "machine-a", 60_000));
    valueOf(await mailboxOf(store).send("gh-12", { id: "m-1", from: "person", data: {} }));
    valueOf(await artifactsOf(store).write("gh-12", "handoffs/03.md", "handoff"));
    expect(Object.keys(files.snapshot())).toEqual([
      `${STORY}/artifacts/handoffs%2f03.md`,
      `${STORY}/claim.json`,
      `${STORY}/mailbox.json`,
      `${SLICE}/state.json`,
      receiptFile(OWN, 1, "r-1"),
    ]);
    expect(JSON.parse(files.snapshot()[`${SLICE}/state.json`] as string)).toEqual({ version: 1, data: { step: "plan" } });
  });

  test("archive is one marker beside the story's units", async () => {
    const { store, files } = localStoreWorld();
    valueOf(await store.appendReceipt("gh-12", { id: "r-1", data: {} }));
    valueOf(await store.archive("gh-12"));
    expect(JSON.parse(files.snapshot()[`${STORY}/archived.json`] as string)).toEqual({ archived_at: "2026-11-17T10:00:00.000Z" });
  });

  test("archiving a story with no units writes nothing", async () => {
    const { store, files } = localStoreWorld();
    expect(valueOf(await store.archive("gh-12"))).toEqual({ archived: [] });
    expect(files.snapshot()).toEqual({});
  });

  test("an artifact path starting with a dot is stored under a name that does not, and comes back", async () => {
    const { store, files } = localStoreWorld();
    valueOf(await artifactsOf(store).write("gh-12", ".github/notes.md", "x"));
    expect(Object.keys(files.snapshot())).toEqual([`${STORY}/artifacts/%2egithub%2fnotes.md`]);
    expect(valueOf(await artifactsOf(store).list("gh-12"))).toEqual([".github/notes.md"]);
  });

  test("artifact paths that differ only in case or Unicode normalization stay apart on a file system that folds both", async () => {
    const folding = foldingFiles();
    const store = createLocalStore(memoryHost({ files: folding, repo: { root: "/repo", dataDir: "/machine/repo" } }));
    const ar = artifactsOf(store);
    const nfc = "caf\u00e9.md";
    const nfd = "cafe\u0301.md";
    valueOf(await ar.write("gh-12", "README.md", "upper"));
    valueOf(await ar.write("gh-12", "readme.md", "lower"));
    valueOf(await ar.write("gh-12", nfc, "composed"));
    valueOf(await ar.write("gh-12", nfd, "decomposed"));
    expect(valueOf(await ar.read("gh-12", "README.md"))).toBe("upper");
    expect(valueOf(await ar.read("gh-12", "readme.md"))).toBe("lower");
    expect(valueOf(await ar.read("gh-12", nfc))).toBe("composed");
    expect(valueOf(await ar.read("gh-12", nfd))).toBe("decomposed");
    expect(valueOf(await ar.list("gh-12"))).toEqual(["README.md", nfd, nfc, "readme.md"].sort());
    expect(Object.keys(folding.snapshot()).filter((p) => p.includes("/artifacts/")).length).toBe(4);
  });

  test("an artifact file name not spelled the one way the store spells it reads as corrupt", async () => {
    const { store, files } = localStoreWorld();
    await files.write(`${STORY}/artifacts/README.md`, "made by hand");
    expect(failureOf(await artifactsOf(store).list("gh-12")).code).toBe("invalid");
  });

  test("an artifact path too long for one file name is refused as invalid", async () => {
    const { store, files } = localStoreWorld();
    const long = `${"ä".repeat(60)}.md`;
    expect(encodeArtifactName(long)).toBeNull();
    expect(failureOf(await artifactsOf(store).write("gh-12", long, "x")).code).toBe("invalid");
    expect(files.snapshot()).toEqual({});
  });

  test("host temp files (dot names) in a store folder are passed over", async () => {
    const { store, files } = localStoreWorld();
    valueOf(await store.appendReceipt("gh-12", { id: "r-1", data: {} }));
    await files.write(`${OWN}/receipts/.00000002-r-2.json.tmp-123`, "half");
    await files.write(`${STORY}/artifacts/.spec.md.tmp-9`, "half");
    expect(valueOf(await store.readUnit("gh-12")).receipts.map((r) => r.id)).toEqual(["r-1"]);
    expect(valueOf(await store.appendReceipt("gh-12", { id: "r-2", data: {} })).seq).toBe(2);
    expect(valueOf(await artifactsOf(store).list("gh-12"))).toEqual([]);
  });
});

describe("claims keep their version across a release", () => {
  test("a claim taken after a release never repeats a version a stale reader holds", async () => {
    const { store } = localStoreWorld();
    const first = valueOf(await store.claims.acquire("gh-12", "machine-a", 60_000));
    valueOf(await store.claims.release("gh-12", "machine-a"));
    const second = valueOf(await store.claims.acquire("gh-12", "machine-b", 60_000));
    expect(second.version).toBeGreaterThan(first.version);
    expect(failureOf(await store.claims.acquire("gh-12", "machine-a", 60_000, first.version)).code).toBe("conflict");
  });
});

describe("a corrupt record is reported as invalid, naming the file, and never read past", () => {
  const corrupt = async (seed: Record<string, string>) => {
    const files = memoryFiles(seed);
    return { files, store: localStoreWorld({}, files).store };
  };
  const invalidNaming = (r: PluginResult<unknown>, path: string) => {
    const f = failureOf(r);
    expect({ code: f.code, retryable: f.retryable, names: f.message.includes(path) }).toEqual({ code: "invalid", retryable: false, names: true });
  };

  test("state that is not JSON: readUnit and commitState refuse, and the file is left as it was", async () => {
    const path = `${OWN}/state.json`;
    const { store, files } = await corrupt({ [path]: '{"version": 1, "data": ' });
    invalidNaming(await store.readUnit("gh-12"), path);
    invalidNaming(await store.commitState("gh-12", { step: "x" }, 1), path);
    expect(files.snapshot()).toEqual({ [path]: '{"version": 1, "data": ' });
  });

  test("state JSON outside the envelope (version 0, an extra field) is refused", async () => {
    for (const text of [JSON.stringify({ version: 0, data: {} }), JSON.stringify({ version: 1, data: {}, extra: true }), "[]"]) {
      const path = `${OWN}/state.json`;
      const { store } = await corrupt({ [path]: text });
      invalidNaming(await store.readUnit("gh-12"), path);
    }
  });

  test("a receipt whose content disagrees with its file name is refused", async () => {
    const path = receiptFile(OWN, 1, "r-1");
    const { store } = await corrupt({ [path]: receiptText(1, "r-other") });
    invalidNaming(await store.readUnit("gh-12"), path);
  });

  test("a gap in the receipt seqs is refused by read and append alike", async () => {
    const gap = receiptFile(OWN, 3, "r-3");
    const { store, files } = await corrupt({ [receiptFile(OWN, 1, "r-1")]: receiptText(1, "r-1"), [gap]: receiptText(3, "r-3") });
    invalidNaming(await store.readUnit("gh-12"), gap);
    invalidNaming(await store.appendReceipt("gh-12", { id: "r-4", data: {} }), gap);
    expect(Object.keys(files.snapshot())).toHaveLength(2);
  });

  test("a repeated receipt id is refused", async () => {
    const dup = receiptFile(OWN, 2, "r-1");
    const { store } = await corrupt({ [receiptFile(OWN, 1, "r-1")]: receiptText(1, "r-1"), [dup]: receiptText(2, "r-1") });
    invalidNaming(await store.readUnit("gh-12"), dup);
  });

  test("a stranger in the receipts folder is refused", async () => {
    const path = `${OWN}/receipts/notes.txt`;
    const { store } = await corrupt({ [path]: "hello" });
    invalidNaming(await store.readUnit("gh-12"), path);
  });

  test("a corrupt claim file is refused by read and acquire", async () => {
    const path = `${STORY}/claim.json`;
    const { store } = await corrupt({ [path]: JSON.stringify({ version: 2, claim: { story: "gh-12", holder: "a", acquired_at: "x", expires_at: "y", version: 2 } }) });
    invalidNaming(await store.claims.read("gh-12"), path);
    invalidNaming(await store.claims.acquire("gh-12", "machine-a", 1_000), path);
  });

  test("a claim file whose claim disagrees with the file's version is refused", async () => {
    const path = `${STORY}/claim.json`;
    const claim = { story: "gh-12", holder: "a", acquired_at: "2026-11-17T10:00:00.000Z", expires_at: "2026-11-17T10:01:00.000Z", version: 1 };
    const { store } = await corrupt({ [path]: JSON.stringify({ version: 2, claim }) });
    invalidNaming(await store.claims.read("gh-12"), path);
  });

  test("a corrupt mailbox is refused by receive and send", async () => {
    const path = `${STORY}/mailbox.json`;
    const { store } = await corrupt({ [path]: JSON.stringify({ messages: [{ id: "../x", from: "p", at: "2026-11-17T10:00:00.000Z", data: 1 }], acked: [] }) });
    invalidNaming(await mailboxOf(store).receive("gh-12"), path);
    invalidNaming(await mailboxOf(store).send("gh-12", { id: "m-1", from: "p", data: {} }), path);
  });

  test("a file in the artifacts folder no artifact path encodes to is refused", async () => {
    const path = `${STORY}/artifacts/a%2f..%2fb.md`;
    const { store } = await corrupt({ [path]: "x" });
    invalidNaming(await artifactsOf(store).list("gh-12"), path);
  });
});

describe("every write runs under its lock", () => {
  /** files whose write to one path rejects, as a full disk would mid-call */
  function failingWriteTo(target: RegExp): { files: HostFiles; inner: ReturnType<typeof memoryFiles> } {
    const inner = memoryFiles();
    return {
      inner,
      files: {
        ...inner,
        write: async (path, data) => {
          if (target.test(path)) throw new Error(`write ${path}: no space left (injected)`);
          return inner.write(path, data);
        },
      },
    };
  }

  test("a failed record write answers unavailable and leaves no lock behind", async () => {
    const { files, inner } = failingWriteTo(/state\.json$/);
    const store = createLocalStore(memoryHost({ files, repo: { root: "/repo", dataDir: "/machine/repo" } }));
    const f = failureOf(await store.commitState("gh-12", { step: "x" }, null));
    expect(f).toMatchObject({ code: "unavailable", retryable: true });
    expect(f.message).toContain("no space left");
    expect(inner.snapshot()).toEqual({});
  });

  test("a lock held by another writer makes a commit give up as unavailable within the bound, writing nothing", async () => {
    const lock = `${OWN}/state.json.lock`;
    const held = JSON.stringify({ token: "other-process", at: "2026-11-17T10:00:00.000Z" });
    const files = memoryFiles({ [lock]: held });
    const { store } = localStoreWorld({ lock: { attempts: 3, retryMs: 1 } }, files);
    expect(failureOf(await store.commitState("gh-12", { step: "x" }, null))).toMatchObject({ code: "unavailable", retryable: true });
    expect(files.snapshot()).toEqual({ [lock]: held });
  });

  test("a lock left by a writer that died is taken over once stale", async () => {
    const lock = `${STORY}/claim.json.lock`;
    const files = memoryFiles({ [lock]: JSON.stringify({ token: "dead", at: "2026-11-17T09:00:00.000Z" }) });
    const { store } = localStoreWorld({ lock: { attempts: 3, retryMs: 1 } }, files);
    expect(valueOf(await store.claims.acquire("gh-12", "machine-a", 60_000)).holder).toBe("machine-a");
    expect(Object.keys(files.snapshot())).toEqual([`${STORY}/claim.json`]);
  });
});

describe("the plugin", () => {
  test("offers store local through defineNornPlugin, and createStore makes a store that fits the contract", () => {
    expect(localStorePlugin.name).toBe(PLUGIN_NAME);
    const factory = localStorePlugin.provides.store?.local;
    if (!factory) throw new Error("no local store factory");
    const made = valueOf(createStore(factory, memoryHost(), {}));
    expect(storeProblems(made)).toEqual([]);
    expect(made.name).toBe("local");
    expect(made.capabilities).toEqual({ shared: false, claims: "local", mailbox: true, artifacts: true, takeover: true });
  });

  test("an unknown config key is refused", () => {
    const factory = localStorePlugin.provides.store?.local;
    if (!factory) throw new Error("no local store factory");
    expect(failureOf(createStore(factory, memoryHost(), { remote: "origin" })).code).toBe("invalid");
  });
});
