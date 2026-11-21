/**
 * The grant a pack's roles give a step written with by:, as the runtime hands it to decide, the loader
 * and the launcher: the role's capabilities narrowed by allow:, with a step that may change no code
 * launched under the docs-only guard.
 */
import { describe, expect, test } from "bun:test";
import type { RoleDefinition } from "@norn/plugin-api";
import { type AgentRunRequest, briefOf } from "../../src/index.ts";
import { harness, has, tickUntil, trackerItem } from "./support.ts";

const ROLES: Record<string, RoleDefinition> = {
  builder: { purpose: "Builds.", allow: ["code:write", "docs:write", "exec:any"] },
  reviewer: { purpose: "Reviews.", allow: ["code:read", "docs:write", "out:findings"] },
};

describe("a step's grant from its pack's roles", () => {
  test("a reviewer's run is briefed with its role's capabilities and launched under the docs-only guard", async () => {
    const h = harness({ workflow: "granted", roles: ROLES });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    const start = h.launcher.calls.find((c) => c.op === "start")?.args[0] as AgentRunRequest | undefined;
    expect(start?.brief.grant).toEqual(["code:read", "docs:write", "out:findings"]);
    expect(start?.writes).toBe("docs");
  });

  test("norn brief renders the same grant under Rules as the launch did", async () => {
    const h = harness({ workflow: "granted", roles: ROLES });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const r = await briefOf(h.env, "lt-1");
    expect(r.ok ? r.value.markdown : "").toContain("- This step is granted `code:read`, `docs:write` and `out:findings`, and nothing else.");
  });

  test("the person's policy caps the grant", async () => {
    const h = harness({ workflow: "granted", roles: ROLES, kernel: { capabilities: ["code:read", "docs:write"] } });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    const start = h.launcher.calls.find((c) => c.op === "start")?.args[0] as AgentRunRequest | undefined;
    expect(start?.brief.grant).toEqual(["code:read", "docs:write"]);
  });

  test("a workflow whose allow: asks more than its role may be granted does not load", () => {
    const h = harness({ roles: ROLES });
    const wide = h.env.workflows.widened;
    expect(wide?.ok).toBe(false);
    expect(wide && !wide.ok ? wide.errors.map((e) => e.message) : []).toContain("role reviewer may not be granted `code:write`: allow: narrows a role's capabilities (code:read, docs:write, out:findings), never widens them");
  });
});
