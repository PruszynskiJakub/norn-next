import type { HostContext, Store } from "@norn/plugin-api";
import { refsArtifacts } from "./artifacts.ts";
import { refsClaims } from "./claims.ts";
import { DEFAULT_REMOTE, REFS_STORE_CAPABILITIES, type RefsStoreConfig } from "./config.ts";
import type { RefsContext } from "./context.ts";
import { refsFloor } from "./floor.ts";
import { gitRunner } from "./git.ts";
import { refsMailbox } from "./mailbox.ts";
import { flush, sync } from "./share.ts";
import { appendReceipt, archive, commitState, listUnits, readUnit } from "./units.ts";

export function createRefsStore(ctx: HostContext, config: RefsStoreConfig = {}): Store {
  // two stores in one clone may make the same change at the same host time; a distinct message keeps their commits distinct
  const token = crypto.randomUUID();
  let n = 0;
  const rc: RefsContext = {
    git: gitRunner(ctx),
    now: () => ctx.now(),
    remote: config.remote ?? DEFAULT_REMOTE,
    message: () => `norn store write\n\nwriter ${token} ${++n}`,
  };
  return {
    name: "refs",
    capabilities: { ...REFS_STORE_CAPABILITIES },
    listUnits: (q) => listUnits(rc, q),
    readUnit: (unit) => readUnit(rc, unit),
    appendReceipt: (unit, r) => appendReceipt(rc, unit, r),
    commitState: (unit, data, expectVersion) => commitState(rc, unit, data, expectVersion),
    claims: refsClaims(rc),
    mailbox: refsMailbox(rc),
    artifacts: refsArtifacts(rc),
    floor: refsFloor(rc),
    archive: (story) => archive(rc, story),
    sync: () => sync(rc),
    flush: (story) => flush(rc, story),
  };
}
