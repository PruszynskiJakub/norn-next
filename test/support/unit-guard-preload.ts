/**
 * Unit guard preload: the root bunfig (the unit tier) preloads it, so every unit test that starts a
 * child process fails. The integration config does not.
 */
import { afterEach } from "bun:test";
import { installUnitGuard } from "./unit-guard.ts";

const guard = installUnitGuard();
afterEach(() => guard.check());
