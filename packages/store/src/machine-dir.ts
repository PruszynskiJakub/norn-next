/**
 * The checkout's machine dir, `<norn home>/repos/<folder>-<hash8>/` (B5, D1–D3): its `checkout.json`
 * names the checkout it belongs to, so `norn doctor` can tell a dir orphaned by a moved repo folder.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { atomicWriteJson } from "./fsx.ts";
import { readLocalJson } from "./local-json.ts";
import { checkoutFilePath, checkoutOf, machineDir, machineReposDir } from "./paths.ts";

/** Write `checkout.json` in `root`'s machine dir when it has none yet. */
export function ensureCheckoutFile(root: string): void {
  const path = checkoutFilePath(machineDir(root));
  if (!existsSync(path)) atomicWriteJson(path, { checkout: checkoutOf(root).checkout });
}

export interface OrphanedMachineDir {
  /** the orphaned machine dir */
  dir: string;
  /** the checkout path its `checkout.json` names, which no longer exists */
  checkout: string;
}

/**
 * D3: machine dirs in `home` whose `checkout.json` names a path with `root`'s folder name that no longer
 * exists — left behind when this repo folder moved. Reads only.
 */
export function orphanedMachineDirs(home: string, root: string): OrphanedMachineDir[] {
  const repos = machineReposDir(home);
  const own = machineDir(root);
  const folder = basename(checkoutOf(root).checkout);
  let names: string[];
  try {
    names = readdirSync(repos);
  } catch {
    return [];
  }
  return names
    .map((n) => join(repos, n))
    .filter((dir) => dir !== own)
    .flatMap((dir) => {
      const checkout = readLocalJson("local-checkout", checkoutFilePath(dir), { checkout: "" }).checkout;
      return checkout && basename(checkout) === folder && !existsSync(checkout) ? [{ dir, checkout }] : [];
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
}
