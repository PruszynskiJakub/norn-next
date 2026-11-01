/**
 * Unit guard preload (B4, D2): the root bunfig (the unit tier) preloads it, so every unit test that starts a
 * child process fails. The integration and e2e configs do not.
 */
import { afterEach } from "bun:test";
import { installUnitGuard } from "./unit-guard.ts";

const guard = installUnitGuard();
afterEach(() => guard.check());
