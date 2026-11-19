/**
 * Who this machine claims as. A hostname is no identity: macOS's follows the network, so one
 * machine answers `mac.home` on one network and `MacBook-Pro.local` on the next, and a claim taken
 * under one name would read as another machine's. The machine's name is fixed once per norn home, from
 * its LocalHostName where it has one, and every process reads it back. Names the hostname gave
 * besides it (before the home had one, or from a binary that still derives it) are kept as former
 * names, so a claim taken under one is still this machine's.
 */
import { type HostContext, parseJson } from "@norn/plugin-api";
import { NonEmpty } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { homePaths } from "./home.ts";
import { corruptError } from "./output.ts";
import { defaultHolder } from "./wiring.ts";

/** The machine's name, not a holder: one home may serve more than one user, each claiming as user@machine. */
export const HolderFile = Type.Object({ machine: NonEmpty, former: Type.Array(NonEmpty) }, { additionalProperties: false, title: "HolderFile" });
export type HolderFile = Static<typeof HolderFile>;

/** Names any machine may answer to: never evidence that a claim is this one's. */
const GENERIC = new Set(["localhost", "localhost.localdomain"]);

export interface MachineHolder {
  holder: string;
  /** names this home claimed under before `holder` */
  former: string[];
}

/**
 * The home's holder, its machine name written on first use. `hostname` is what the network calls the
 * machine now; a name it gives that the home has not seen is added to the former names.
 */
export async function machineHolder(ctx: HostContext, home: string, env: Readonly<Record<string, string | undefined>>, hostname: string): Promise<MachineHolder> {
  const path = homePaths(home).holder;
  const seen = GENERIC.has(hostname) ? null : hostname;
  let file = await readHolder(ctx, path);
  if (file === null) {
    const first = await firstMachine(ctx, hostname);
    // exclusive, so two processes starting at once settle on one file
    file = (await ctx.files.create(path, text(first))) ? first : await readHolder(ctx, path);
    if (file === null) file = first;
  }
  if (seen !== null && seen !== file.machine && !file.former.includes(seen)) {
    file = { machine: file.machine, former: [...file.former, seen] };
    await ctx.files.write(path, text(file));
  }
  return { holder: defaultHolder(env, file.machine), former: file.former.map((n) => defaultHolder(env, n)) };
}

async function readHolder(ctx: HostContext, path: string): Promise<HolderFile | null> {
  const raw = await ctx.files.read(path);
  if (raw === null) return null;
  const r = parseJson(HolderFile, raw, path);
  // a new name would strand every claim taken under the old one: a person repairs the file instead
  if (!r.ok) throw corruptError(`${path} is not a valid holder file: ${r.failure.message}`, `fix it to {"machine": "<name>", "former": []}, keeping the name this machine claimed under`);
  return r.value;
}

/** The machine's LocalHostName where it has one (macOS), else its hostname. */
async function firstMachine(ctx: HostContext, hostname: string): Promise<HolderFile> {
  let local = "";
  try {
    const out = await ctx.exec(["scutil", "--get", "LocalHostName"]);
    if (out.code === 0) local = out.stdout.trim();
  } catch {
    local = "";
  }
  const machine = local || hostname;
  const names = [GENERIC.has(hostname) ? null : hostname, local ? `${local}.local` : null];
  return { machine, former: [...new Set(names.filter((n): n is string => n !== null && n !== machine))] };
}

const text = (file: HolderFile): string => `${JSON.stringify(file)}\n`;
