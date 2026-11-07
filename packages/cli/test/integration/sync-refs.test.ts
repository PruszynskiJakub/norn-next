/**
 * The sync fetch: a tick's sync fetches claim and mailbox refs by name, never
 * every `refs/norn/*` ref, so archive refs (`refs/norn/runs/<story>`) do not ride along with every
 * sync; pruning still works within each prefix.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { claimRef, mailboxRef, ulid } from "@norn/schema";
import { createHarness, type Harness, sh } from "../../../../test/support/harness.ts";

let h: Harness;
const CLAIM = claimRef("gh-9");
const MAILBOX = mailboxRef("gh-9", ulid());
const OTHER = "refs/norn/runs/gh-9";

/** A blob ref written with plain git on the bare remote: no norn code writes `OTHER` yet. */
const remoteRef = (ref: string, text: string) => {
  const sha = sh(h.remoteDir, ["hash-object", "-w", "--stdin"], text).trim();
  h.git(["update-ref", ref, sha], h.remoteDir);
};
const localRefs = () =>
  h
    .git(["for-each-ref", "--format=%(refname)", "refs/norn/"])
    .split("\n")
    .filter(Boolean)
    .sort();
const sync = async () => {
  h.clock.advance(10_000);
  await h.tick("--sync");
};

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("sync fetches only claim and mailbox refs (B30)", () => {
  test("a tick brings the claim and the mailbox ref and not a ref under another refs/norn/ prefix (AC1)", async () => {
    remoteRef(CLAIM, "claim\n");
    remoteRef(MAILBOX, "answer\n");
    remoteRef(OTHER, "record\n");
    await sync();
    expect(localRefs()).toEqual([MAILBOX, CLAIM].sort());
  });

  test("a claim or mailbox ref deleted on the remote is gone locally after the next tick (AC2)", async () => {
    h.git(["update-ref", "-d", CLAIM], h.remoteDir);
    h.git(["update-ref", "-d", MAILBOX], h.remoteDir);
    await sync();
    expect(localRefs()).not.toContain(CLAIM);
    expect(localRefs()).not.toContain(MAILBOX);
  });
});
