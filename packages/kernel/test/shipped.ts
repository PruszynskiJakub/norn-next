/**
 * The shipped workflows as the kernel loads them: the files in packages/pack-sdlc/assets/workflows, and
 * the plugin step kinds they use as the plugins providing them declare them. Shared by the loader's
 * tests and the golden corpus, so both load the same documents.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type TSchema, Type } from "@sinclair/typebox";
import { parse } from "yaml";
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow, loadWorkflow, type StepKindInfo } from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
export const SHIPPED = join(ROOT, "packages", "pack-sdlc", "assets", "workflows");

export const kind = (
  name: string,
  outcomes: string[],
  mode: "effect" | "wait" = "effect",
  configSchema: TSchema = Type.Object({}, { additionalProperties: false }),
  slot?: StepKindInfo["slot"],
): StepKindInfo => ({ name, configSchema, outcomes, mode, ...(slot && { slot }) });

const NONE = Type.Object({}, { additionalProperties: false });

/** The step kinds the shipped workflows use, as the plugins that provide them declare them. */
export const STEP_KINDS: Record<string, StepKindInfo> = {
  "update-branch": kind("update-branch", ["done", "conflict", "clean", "resolved"], "effect", NONE, "vcs"),
  integrate: kind("integrate", ["done", "conflict"], "effect", NONE, "vcs"),
  "open-pr": { ...kind("open-pr", ["done"], "effect", NONE, "forge"), reads: [{ name: "pr_body", fallback: "the body file an earlier pass left, else norn's footer alone" }] },
  push: kind("push", ["done"], "effect", NONE, "vcs"),
  "await-checks": kind("await-checks", ["pass", "fail", "stale"], "wait", Type.Object({ appear: Type.Optional(Type.String()), settle: Type.Optional(Type.String()) }, { additionalProperties: false }), "forge"),
  "await-merge": { ...kind("await-merge", ["merged", "unpushed"], "wait", NONE, "forge"), effects: ["forge-write"] },
};

export const readShipped = (file: string): Record<string, unknown> => parse(readFileSync(join(SHIPPED, file), "utf8"));

/** Every shipped workflow file by file name, and the shared files by name. */
export function shipped(): { workflows: Record<string, unknown>; shared: Record<string, unknown> } {
  const shared = Object.fromEntries(
    readdirSync(join(SHIPPED, "shared"))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => [f.replace(/\.yaml$/, ""), readShipped(`shared/${f}`)]),
  );
  const workflows = Object.fromEntries(
    readdirSync(SHIPPED)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => [f, readShipped(f)]),
  );
  return { workflows, shared };
}

/** A shipped workflow (`story`, `quick`, ...) loaded under the default config. */
export function loadShipped(name: string): LoadedWorkflow {
  const { workflows, shared } = shipped();
  const r = loadWorkflow(workflows[`${name}.yaml`], { stepKinds: STEP_KINDS, sharedFiles: shared, config: DEFAULT_KERNEL_CONFIG });
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.errors)}`);
  return r.workflow;
}
