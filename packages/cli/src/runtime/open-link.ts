/** CP8, B17: open a link with the platform opener (`open` on macOS, `xdg-open` elsewhere), or the injected shell. */
import { spawnBounded } from "@norn/store";
import type { Context } from "../context.ts";

export async function openLink(ctx: Context, url: string): Promise<{ code: number; stderr: string }> {
  const argv = [process.platform === "darwin" ? "open" : "xdg-open", url];
  if (ctx.deps.shell) return ctx.deps.shell(argv, ctx.root);
  // H11 seam: store's bounded spawn (a missing opener is exit 127, never a throw)
  const r = await spawnBounded(argv, {});
  return { code: r.code, stderr: r.stderr };
}
