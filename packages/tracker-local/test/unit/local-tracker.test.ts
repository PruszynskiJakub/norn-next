/** What the local tracker does beyond the shared contract: its files, ids, whoami and plugin wiring. */
import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost, scriptedExec, steppingClock, valueOf } from "@norn/conformance";
import { createTracker, type HostFiles, PLUGIN_API_VERSION, type PluginResult, type TrackerEffect } from "@norn/plugin-api";
import { createLocalTracker, type ItemFile, localTrackerPlugin, parseItem, renderItem } from "../../src/index.ts";
import { ITEMS_DIR, localWorld, ME } from "./world.ts";

const R1 = "01JDAAAAAAAAAAAAAAAAAAAAA1";
const R2 = "01JDAAAAAAAAAAAAAAAAAAAAA2";

function failureOf<T>(r: PluginResult<T>) {
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r.value)}`);
  return r.failure;
}

const item = (over: Partial<ItemFile> = {}): ItemFile => ({
  frontmatter: {
    title: "Add login",
    open: true,
    assignees: [ME],
    labels: ["norn"],
    created_at: "2026-11-17T09:00:00.000Z",
    updated_at: "2026-11-17T09:00:00.000Z",
    receipts: {},
  },
  body: "As a user I want to log in.",
  comments: [],
  ...over,
});

describe("item file", () => {
  test("a created item is one markdown file with frontmatter, the body and its receipt", async () => {
    const w = localWorld();
    const out = valueOf(await w.tracker.perform({ kind: "create", title: "Fix login", body: "It times out.", labels: ["norn"], assignee: ME }, { receipt_id: R1 }));
    expect(out).toEqual({ kind: "create", id: 1, key: "lt-1", replayed: false });
    expect(w.files.snapshot()).toEqual({
      [`${ITEMS_DIR}/1.md`]: [
        "---",
        "title: Fix login",
        "open: true",
        "assignees:",
        `  - ${ME}`,
        "labels:",
        "  - norn",
        "created_at: 2026-11-17T10:00:00.000Z",
        "updated_at: 2026-11-17T10:00:00.000Z",
        "receipts:",
        `  ${R1}: create`,
        "---",
        "It times out.",
      ].join("\n"),
    });
  });

  test("comments land under ## Comments with their receipt id, and the body splits back off byte for byte", () => {
    const bodies = ["", "one line", "trailing newline\n", "two blank\n\n", "a body that says\n## Comments\nin it"];
    for (const body of bodies) {
      const withComments = item({
        body,
        comments: [
          { receipt_id: R1, at: "2026-11-17T10:00:00.000Z", body: "first" },
          { receipt_id: R2, at: "2026-11-17T10:00:01.000Z", body: "" },
          { receipt_id: "r3", at: "2026-11-17T10:00:02.000Z", body: "multi\n\nline\n" },
        ],
      });
      const text = renderItem(withComments);
      expect(text).toContain(`<!-- norn:comment receipt=${R1} at=2026-11-17T10:00:00.000Z -->\nfirst\n`);
      expect(parseItem(text)).toEqual({ ok: true, value: withComments });
      expect(parseItem(renderItem(item({ body })))).toEqual({ ok: true, value: item({ body }) });
    }
  });

  test.each([
    ["no frontmatter", "just text"],
    ["unclosed frontmatter", "---\ntitle: x\n"],
    ["broken YAML", "---\ntitle: [x\n---\n"],
    ["a field of the wrong type", "---\ntitle: x\nopen: yes please\nassignees: []\nlabels: []\ncreated_at: 2026-11-17T10:00:00.000Z\nupdated_at: 2026-11-17T10:00:00.000Z\nreceipts: {}\n---\n"],
    ["a missing field", "---\ntitle: x\nopen: true\n---\n"],
  ])("a malformed item file (%s) fails every read naming the file, never guessed", async (_, text) => {
    const w = localWorld({}, { [`${ITEMS_DIR}/2.md`]: text, [`${ITEMS_DIR}/1.md`]: renderItem(item()) });
    const answers: PluginResult<unknown>[] = [
      await w.tracker.get(2),
      await w.tracker.intake({ label: "norn", assignee: null }),
      await w.tracker.perform({ kind: "create", title: "x", body: "", labels: [] }, { receipt_id: R1 }),
      await w.tracker.perform({ kind: "close", id: 2 }, { receipt_id: R2 }),
    ];
    for (const r of answers) {
      const f = failureOf(r);
      expect({ code: f.code, retryable: f.retryable, names: f.message.includes(`${ITEMS_DIR}/2.md`) }).toEqual({ code: "invalid", retryable: false, names: true });
    }
    expect(valueOf(await w.tracker.get(1))?.title).toBe("Add login");
    expect(w.files.snapshot()[`${ITEMS_DIR}/2.md`]).toBe(text);
  });

  test("files that are not <id>.md are left alone", async () => {
    const w = localWorld({}, { [`${ITEMS_DIR}/README.md`]: "notes", [`${ITEMS_DIR}/07.md`]: "x", [`${ITEMS_DIR}/3.md.tmp`]: "x" });
    expect(valueOf(await w.tracker.intake({ label: "norn", assignee: null }))).toEqual([]);
    expect(valueOf(await w.tracker.perform({ kind: "create", title: "x", body: "", labels: [] }, { receipt_id: R1 })).id).toBe(1);
  });
});

describe("ids", () => {
  test("create takes max+1, past gaps", async () => {
    const w = localWorld({}, { [`${ITEMS_DIR}/1.md`]: renderItem(item()), [`${ITEMS_DIR}/9.md`]: renderItem(item()) });
    expect(valueOf(await w.tracker.perform({ kind: "create", title: "x", body: "", labels: [] }, { receipt_id: R1 })).key).toBe("lt-10");
  });

  test("an id another creator took first is skipped, never shared", async () => {
    const files = memoryFiles();
    let raced = false;
    const racing: HostFiles = {
      ...files,
      create: async (path, data) => {
        // another creator lands on the same id between this one's listing and its create
        if (!raced) {
          raced = true;
          await files.create(path, renderItem(item({ body: "theirs" })));
        }
        return files.create(path, data);
      },
    };
    const tr = createLocalTracker(memoryHost({ files: racing }), { user: ME });
    const out = valueOf(await tr.perform({ kind: "create", title: "mine", body: "", labels: [] }, { receipt_id: R1 }));
    expect(out.id).toBe(2);
    expect(valueOf(await tr.get(1))?.body).toBe("theirs");
    expect(valueOf(await tr.get(2))?.title).toBe("mine");
  });

  test("two trackers creating at once get distinct ids", async () => {
    const files = memoryFiles();
    const a = createLocalTracker(memoryHost({ files }), { user: ME });
    const b = createLocalTracker(memoryHost({ files }), { user: ME });
    const outs = await Promise.all([
      a.perform({ kind: "create", title: "a", body: "", labels: [] }, { receipt_id: R1 }),
      b.perform({ kind: "create", title: "b", body: "", labels: [] }, { receipt_id: R2 }),
    ]);
    expect(outs.map((o) => valueOf(o).id).sort()).toEqual([1, 2]);
  });
});

describe("receipts", () => {
  test("a replay is found in the files, so a new tracker on the same folder answers it too", async () => {
    const files = memoryFiles();
    const first = createLocalTracker(memoryHost({ files }), { user: ME });
    const created = valueOf(await first.perform({ kind: "create", title: "x", body: "", labels: [] }, { receipt_id: R1 }));
    valueOf(await first.perform({ kind: "comment", id: 1, body: "hello" }, { receipt_id: R2 }));
    const later = createLocalTracker(memoryHost({ files }), { user: ME });
    expect(valueOf(await later.perform({ kind: "create", title: "x", body: "", labels: [] }, { receipt_id: R1 }))).toEqual({ ...created, replayed: true });
    expect(valueOf(await later.perform({ kind: "comment", id: 1, body: "hello" }, { receipt_id: R2 })).replayed).toBe(true);
    expect(Object.keys(files.snapshot())).toEqual([`${ITEMS_DIR}/1.md`]);
  });

  test("a failed write leaves the item as it was, receipt included, so the effect can be performed again", async () => {
    const w = localWorld({}, { [`${ITEMS_DIR}/1.md`]: renderItem(item()) });
    const before = w.files.snapshot();
    w.files.failWrites(true);
    const effects: TrackerEffect[] = [
      { kind: "comment", id: 1, body: "x" },
      { kind: "close", id: 1 },
      { kind: "create", title: "x", body: "", labels: [] },
    ];
    for (const e of effects) expect(failureOf(await w.tracker.perform(e, { receipt_id: R1 }))).toMatchObject({ code: "unavailable", retryable: true });
    expect(w.files.snapshot()).toEqual(before);
    w.files.failWrites(false);
    expect(valueOf(await w.tracker.perform({ kind: "close", id: 1 }, { receipt_id: R1 })).replayed).toBe(false);
  });

  test("an effect that changes nothing visible keeps updated_at but still records its receipt", async () => {
    const w = localWorld({}, { [`${ITEMS_DIR}/1.md`]: renderItem(item()) });
    valueOf(await w.tracker.perform({ kind: "assign", id: 1, user: ME }, { receipt_id: R1 }));
    const parsed = parseItem(w.files.snapshot()[`${ITEMS_DIR}/1.md`] as string);
    if (!parsed.ok) throw new Error(parsed.problem);
    expect(parsed.value.frontmatter.updated_at).toBe("2026-11-17T09:00:00.000Z");
    expect(parsed.value.frontmatter.receipts).toEqual({ [R1]: "assign" });
  });

  test("a malformed effect or a receipt id the file cannot hold is refused, changing nothing", async () => {
    const w = localWorld({}, { [`${ITEMS_DIR}/1.md`]: renderItem(item()) });
    const before = w.files.snapshot();
    expect(failureOf(await w.tracker.perform({ kind: "close", id: 0 } as TrackerEffect, { receipt_id: R1 })).code).toBe("invalid");
    for (const receipt_id of ["", "has space", "x-->y", "a".repeat(65)])
      expect(failureOf(await w.tracker.perform({ kind: "close", id: 1 }, { receipt_id })).code).toBe("invalid");
    expect(w.files.snapshot()).toEqual(before);
  });
});

describe("whoami", () => {
  test("the configured user wins, and git is never asked", async () => {
    const w = localWorld({ user: "jane" });
    expect(valueOf(await w.tracker.whoami())).toBe("jane");
    expect(w.exec.calls).toEqual([]);
  });

  test("otherwise git's user.email, asked in the repo root", async () => {
    const w = localWorld();
    expect(valueOf(await w.tracker.whoami())).toBe(ME);
    expect(w.exec.calls.map((c) => [c.argv, c.opts.cwd])).toEqual([[["git", "config", "user.email"], "/repo"]]);
  });

  test("no user anywhere is an auth failure, and intake for me fails with it", async () => {
    for (const answer of [{ code: 1 }, { stdout: "  \n" }, { timedOut: true, code: 143 }]) {
      const tr = createLocalTracker(memoryHost({ exec: scriptedExec(() => answer) }), {});
      expect(failureOf(await tr.whoami())).toMatchObject({ code: "auth", retryable: false });
      expect(failureOf(await tr.intake({ label: "norn", assignee: "me" })).code).toBe("auth");
    }
  });

  test("an exec that rejects is unavailable, not a throw", async () => {
    const tr = createLocalTracker(
      memoryHost({
        exec: async () => {
          throw new Error("spawn failed");
        },
      }),
      {},
    );
    expect(failureOf(await tr.whoami())).toMatchObject({ code: "unavailable", retryable: true });
  });
});

describe("plugin", () => {
  const host = () => memoryHost({ now: steppingClock("2026-11-17T10:00:00.000Z") });

  test("provides the local tracker, made through the host with its config checked", async () => {
    expect(localTrackerPlugin.name).toBe("norn-tracker-local");
    expect(PLUGIN_API_VERSION.startsWith("1.")).toBe(true);
    const factory = localTrackerPlugin.provides.tracker?.local;
    if (!factory) throw new Error("no local tracker");
    const made = valueOf(createTracker(factory, host(), {}));
    expect({ name: made.name, keyPrefix: made.keyPrefix, capabilities: made.capabilities }).toEqual({
      name: "local",
      keyPrefix: "lt",
      capabilities: { assign: true, labels: true, comment: true, create: true, close: true },
    });
    expect(valueOf(createTracker(factory, host(), { keyPrefix: "todo", user: ME })).keyPrefix).toBe("todo");
    for (const bad of [{ keyPrefix: "LT" }, { keyPrefix: "toolongprefix" }, { dir: "" }, { other: 1 }])
      expect(failureOf(createTracker(factory, host(), bad)).code).toBe("invalid");
  });

  test("items live under the machine folder unless a folder is configured", async () => {
    const files = memoryFiles();
    const ctx = memoryHost({ files, repo: { root: "/repo", dataDir: "/data/r1" } });
    await createLocalTracker(ctx, { user: ME }).perform({ kind: "create", title: "x", body: "", labels: [] }, { receipt_id: R1 });
    await createLocalTracker(ctx, { user: ME, dir: "/shared/items" }).perform({ kind: "create", title: "y", body: "", labels: [] }, { receipt_id: R1 });
    expect(Object.keys(files.snapshot())).toEqual(["/data/r1/tracker/1.md", "/shared/items/1.md"]);
  });
});
