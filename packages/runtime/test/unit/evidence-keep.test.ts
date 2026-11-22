/**
 * A QA report keeps the files its run wrote to `$NORN_OUT/evidence/` as one commit the receipt names,
 * through `reportRun` over the fake vcs: what the vcs was asked to keep, and the receipt, are the observations.
 */
import { describe, expect, test } from "bun:test";
import { fail, ok } from "@norn/plugin-api";
import { reportRun } from "../../src/index.ts";
import { png } from "./images.ts";
import { harness, type HarnessOptions, has, record, tickUntil, trackerItem } from "./support.ts";

const UNIT = "lt-1";
const WT = "/machine/repo/worktrees/lt-1";
const OUT = `${WT}/.agents/run/out/evidence`;
const COPIES = `${WT}/.agents/run/evidence`;
const REF = "refs/norn/evidence/lt-1";
const PASS = [{ id: "AC1", verdict: "pass" as const, evidence: "ran it" }];
const MB = 1024 * 1024;

const gradient = (x: number, y: number) => [x % 256, y % 256, (x + y) % 256];
/** A screenshot the compressor re-encodes as a smaller WebP. */
const SCREENSHOT = png(2400, 1200, gradient);

/** A QA run (its step produces criteria) at a forge that serves a commit's files. */
async function qa(opts: HarnessOptions = {}) {
  const h = harness({ workflow: "passed", rawUrls: true, ...opts });
  h.items.push(trackerItem(1));
  await tickUntil(h, has("agent.start"));
  await tickUntil(h, has("receipts.apply"));
  const runId = (await record(h, UNIT)).state?.run?.id;
  if (!runId) throw new Error("no run started");
  return { h, runId };
}

type H = Awaited<ReturnType<typeof qa>>["h"];

const pass = (h: H, runId: string, id = "r1") => reportRun(h.env, UNIT, runId, { verb: "done", outcome: "pass", criteria: PASS }, id);
const reported = async (h: H) => (await record(h, UNIT)).receipts.findLast((r) => r.data.kind === "run.reported")?.data;
const calls = (h: H, op: string) => h.vcsCalls.filter((c) => c.op === op);

describe("keeping evidence on a QA report", () => {
  test("every evidence file is kept in one commit the receipt names, a screenshot as WebP, and the ref moves only after the receipt is written", async () => {
    const { h, runId } = await qa();
    await h.files.write(`${OUT}/AC1.md`, "ran it\n");
    await h.files.writeBytes(`${OUT}/AC2.png`, SCREENSHOT);
    const moveRef = h.env.slots.vcs.moveRef?.bind(h.env.slots.vcs);
    let receiptBeforeMove = false;
    h.env.slots.vcs.moveRef = async (ref, commit) => {
      receiptBeforeMove = (await reported(h)) !== undefined;
      return moveRef ? moveRef(ref, commit) : ok({ moved: true });
    };
    const r = await pass(h, runId);
    expect(r.ok).toBe(true);
    const keeps = calls(h, "keepFiles");
    expect(keeps).toHaveLength(1);
    expect(keeps[0]?.args).toEqual([
      REF,
      [
        { path: "AC1.md", at: `${OUT}/AC1.md` },
        { path: "AC2.webp", at: `${COPIES}/AC2.webp` },
      ],
      expect.any(String),
    ]);
    const commit = "e".repeat(39) + "1";
    expect((await reported(h)) as unknown).toMatchObject({
      evidence: {
        commit,
        files: [
          { name: "AC1.md", kept: "AC1.md" },
          { name: "AC2.png", kept: "AC2.webp" },
        ],
      },
    });
    expect(r.ok && r.value.evidence).toEqual({
      commit,
      files: [
        { name: "AC1.md", kept: "AC1.md" },
        { name: "AC2.png", kept: "AC2.webp" },
      ],
    });
    expect(calls(h, "moveRef").map((c) => c.args)).toEqual([[REF, commit]]);
    expect(receiptBeforeMove).toBe(true);
    const webp = await h.files.readBytes(`${COPIES}/AC2.webp`);
    expect(webp && webp.length < SCREENSHOT.length).toBe(true);
  });

  test("the local files are left byte for byte as the agent wrote them", async () => {
    const { h, runId } = await qa();
    await h.files.writeBytes(`${OUT}/AC2.png`, SCREENSHOT);
    expect((await pass(h, runId)).ok).toBe(true);
    expect(await h.files.readBytes(`${OUT}/AC2.png`)).toEqual(SCREENSHOT);
    expect(await h.files.list(OUT)).toEqual(["AC2.png"]);
  });

  test("a file over 10 MB once compressed is left out and named, an unreadable image is kept as it was and named, and the report goes through", async () => {
    const { h, runId } = await qa();
    await h.files.write(`${OUT}/AC1.md`, "ran it\n");
    await h.files.write(`${OUT}/AC3.png`, "not an image");
    await h.files.writeBytes(`${OUT}/AC4.log`, new Uint8Array(Math.round(14.2 * MB)).fill(97));
    const r = await pass(h, runId);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.evidenceNotes).toEqual(["AC3.png kept uncompressed: not a readable PNG", "AC4.log not kept: 14.2 MB is over the 10 MB limit"]);
    expect(calls(h, "keepFiles")[0]?.args[1]).toEqual([
      { path: "AC1.md", at: `${OUT}/AC1.md` },
      { path: "AC3.png", at: `${OUT}/AC3.png` },
    ]);
    expect(((await reported(h)) as { evidence?: unknown }).evidence).toMatchObject({
      files: [
        { name: "AC1.md", kept: "AC1.md" },
        { name: "AC3.png", kept: "AC3.png" },
      ],
    });
  });

  test("a re-encoded name another file already has keeps the original extension too", async () => {
    const { h, runId } = await qa();
    await h.files.writeBytes(`${OUT}/AC2.png`, SCREENSHOT);
    await h.files.write(`${OUT}/AC2.webp`, "not an image");
    expect((await pass(h, runId)).ok).toBe(true);
    expect(((await reported(h)) as { evidence?: unknown }).evidence).toMatchObject({
      files: [
        { name: "AC2.png", kept: "AC2.png.webp" },
        { name: "AC2.webp", kept: "AC2.webp" },
      ],
    });
  });

  test("a folder in the evidence folder is no file to keep, and no evidence at all keeps nothing", async () => {
    for (const seed of [{}, { [`${OUT}/shots/a.txt`]: "x" }]) {
      const { h, runId } = await qa();
      for (const [p, d] of Object.entries(seed)) await h.files.write(p, d);
      const r = await pass(h, runId);
      expect(r.ok).toBe(true);
      expect(r.ok && r.value.evidence).toBeUndefined();
      expect(await reported(h)).not.toHaveProperty("evidence");
      expect(calls(h, "keepFiles")).toEqual([]);
      expect(calls(h, "moveRef")).toEqual([]);
    }
  });

  test("a refused report keeps nothing, and the report that goes through keeps the files there at that moment", async () => {
    const { h, runId } = await qa();
    await h.files.write(`${OUT}/AC1.md`, "first\n");
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "shipped", criteria: PASS }, "r1")).toMatchObject({ ok: false, refusal: { code: "outcome" } });
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "pass" }, "r2")).toMatchObject({ ok: false });
    expect(calls(h, "keepFiles")).toEqual([]);
    await h.files.remove(`${OUT}/AC1.md`);
    await h.files.write(`${OUT}/AC2.md`, "second\n");
    expect((await pass(h, runId, "r3")).ok).toBe(true);
    expect(calls(h, "keepFiles").map((c) => c.args[1])).toEqual([[{ path: "AC2.md", at: `${OUT}/AC2.md` }]]);
  });

  test("a done retried once its receipt was written names the same commit and keeps nothing again", async () => {
    const { h, runId } = await qa();
    await h.files.write(`${OUT}/AC1.md`, "ran it\n");
    const first = await pass(h, runId);
    const again = await pass(h, runId);
    expect(again).toMatchObject({ ok: true, value: { replayed: true } });
    expect(again.ok && again.value.evidence).toEqual(first.ok ? first.value.evidence : undefined);
    expect(calls(h, "keepFiles")).toHaveLength(1);
    // the move is repeated, as a crash may have come between the receipt and it; at the same commit it is a no-op
    expect(calls(h, "moveRef").map((c) => c.args)).toEqual([
      [REF, "e".repeat(39) + "1"],
      [REF, "e".repeat(39) + "1"],
    ]);
  });

  test("a ref that cannot be moved leaves the report recorded and says how to move it", async () => {
    const { h, runId } = await qa();
    await h.files.write(`${OUT}/AC1.md`, "ran it\n");
    h.env.slots.vcs.moveRef = async () => fail("unavailable", "lock held");
    const r = await pass(h, runId);
    expect(r.ok && r.value.evidenceNotes).toEqual([expect.stringContaining("was not moved to it: lock held; report again with the same command")]);
    expect(await reported(h)).toHaveProperty("evidence");
  });

  test("a commit the vcs cannot write refuses the report, to be reported again", async () => {
    const { h, runId } = await qa();
    await h.files.write(`${OUT}/AC1.md`, "ran it\n");
    h.env.slots.vcs.keepFiles = async () => fail("unavailable", "disk full");
    const r = await pass(h, runId);
    expect(r).toMatchObject({ ok: false, refusal: { code: "unavailable", error: expect.stringContaining("disk full"), do_instead: "report again with the same command" } });
    expect(await reported(h)).toBeUndefined();
  });
});

describe("a report that keeps no evidence, exactly as before", () => {
  const cases: [string, HarnessOptions, (h: H) => void][] = [
    ["evidence.publish: false", { evidencePublish: false }, () => {}],
    ["a forge without raw_urls", { rawUrls: false }, () => {}],
    [
      "a vcs without keepFiles",
      {},
      (h) => {
        delete h.env.slots.vcs.keepFiles;
      },
    ],
  ];
  for (const [what, opts, adjust] of cases)
    test(what, async () => {
      const { h, runId } = await qa(opts);
      adjust(h);
      await h.files.write(`${OUT}/AC1.md`, "ran it\n");
      const r = await pass(h, runId);
      expect(r.ok && r.value).toEqual({ seq: expect.any(Number), replayed: false, criteria: expect.anything() });
      expect(await reported(h)).not.toHaveProperty("evidence");
      expect(calls(h, "keepFiles")).toEqual([]);
      expect(calls(h, "moveRef")).toEqual([]);
    });

  test("a step that produces no criteria", async () => {
    const h = harness({ workflow: "agented", rawUrls: true });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const runId = (await record(h, UNIT)).state?.run?.id as string;
    await h.files.write(`${OUT}/AC1.md`, "ran it\n");
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(r.ok && r.value).toEqual({ seq: expect.any(Number), replayed: false });
    expect(calls(h, "keepFiles")).toEqual([]);
  });
});
