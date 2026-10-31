/**
 * Test preload (bunfig.toml): an isolated norn home for every test process, so a test that reaches a
 * checkout's machine dir (B5: `<norn home>/repos/<id>/`) without binding a home never writes to ~/.norn.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NORN_HOME_DIR ??= mkdtempSync(join(tmpdir(), "norn-test-home-"));
