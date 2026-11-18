/**
 * herdr's own parser on the argv `send` builds, run against a herdr home with no server in it: a
 * text herdr accepted as text gets as far as `server_not_running`, while one it read as a flag fails
 * parsing (`unknown option`, `requires text`) or turns into an option and leaves another code. No
 * pane of the person's herdr is ever addressed, as the wrapper points herdr at an empty temp home.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost } from "@norn/host-node";
import type { Runner } from "@norn/plugin-api";
import { createHerdrRunner, herdrErrorCode } from "../../src/index.ts";

const herdrPath = Bun.which("herdr");
let root: string;
let wrapper: string;
let runner: Runner;

beforeAll(() => {
  if (!herdrPath) return;
  root = mkdtempSync(join(tmpdir(), "norn-herdr-argv-"));
  wrapper = join(root, "herdr");
  writeFileSync(wrapper, `#!/bin/sh\nexec env -i HOME='${root}' XDG_RUNTIME_DIR='${root}' TMPDIR='${root}' PATH=/usr/bin:/bin '${herdrPath}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  runner = createHerdrRunner(createNodeHost({ root, dataDir: join(root, "machine") }), { bin: wrapper });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const TEXTS = ["--wait", "- yes, the second one", "--until", "-x", "--", "carry on"];

describe.skipIf(!herdrPath)("herdr parses the text send passes as text", () => {
  test.each(TEXTS)("agent prompt %p", async (text) => {
    const r = await runner.send("zz999:p999", text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(herdrErrorCode(r.failure.message)).toBe("server_not_running");
  });

  test.each(TEXTS)("pane send-text %p (the fallback's argv shape)", async (text) => {
    const out = await Bun.$`${wrapper} pane send-text zz999:p999 ${text}`.nothrow().quiet();
    expect(`${out.stdout}${out.stderr}`).toContain("server_not_running");
  });

  test("an end-of-options separator would be herdr's text and the real text a flag", async () => {
    const out = await Bun.$`${wrapper} agent prompt zz999:p999 -- ${"hello"}`.nothrow().quiet();
    expect(`${out.stdout}${out.stderr}`).toContain("unknown option: hello");
  });
});
