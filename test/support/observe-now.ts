/** Observe a harness repo now, as a tick's observe would; shared by the observe snapshots (e2e) and integration tests (gh-118 B16). */
import { ulid } from "@norn/schema";
import { Context, observe, type Observed } from "../../packages/cli/src/index.ts";
import type { Harness } from "./harness.ts";

/** Observe the harness repo now, as a tick's observe would without a remote sync. */
export async function observeNow(h: Harness): Promise<Observed> {
  const ctx = new Context(h.deps);
  await ctx.locate();
  return observe(ctx, { tick_id: ulid(h.clock.now()), sync: "never" });
}
