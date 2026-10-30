/**
 * This machine's name in claims, run records and the inbox (R7.2): `user@host`. `NORN_MACHINE`
 * overrides the host; `@` and whitespace become `_` so the name stays one token.
 */
import { hostname, userInfo } from "node:os";

export function machineHolder(env: Record<string, string | undefined>): string {
  let user = env.USER ?? env.LOGNAME;
  if (!user) {
    try {
      user = userInfo().username;
    } catch {
      user = "norn";
    }
  }
  const host = (env.NORN_MACHINE ?? hostname().split(".")[0] ?? "machine") || "machine";
  return `${user.replace(/[@\s]/g, "_")}@${host.replace(/[@\s]/g, "_")}`;
}
