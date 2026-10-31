/**
 * Unit guard preload (B4, D2): `bun test --preload ./test/support/unit-guard-preload.ts <folder>` fails every
 * test that starts a child process. Slice 07 puts it in the root bunfig for the unit tier.
 */
import { afterEach } from "bun:test";
import { installUnitGuard } from "./unit-guard.ts";

const guard = installUnitGuard();
afterEach(() => guard.check());
