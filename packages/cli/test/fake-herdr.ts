import type { herdr } from "@norn/adapters";

/** A fake Herdr for the cockpit: fixed agents, every call recorded. */
export function fakeHerdr(agents: herdr.HerdrAgent[] = [], workspaces: herdr.HerdrWorkspace[] = []) {
  const calls: string[] = [];
  const cockpit: herdr.HerdrCockpit = {
    async listAgents() {
      return agents;
    },
    async focus(pane) {
      calls.push(`focus ${pane}`);
    },
    async listWorkspaces() {
      return workspaces;
    },
    async focusWorkspace(id) {
      calls.push(`focus workspace ${id}`);
    },
    async label(pane, l) {
      calls.push(`label ${pane} ${l.title} ${l.state_labels.idle ?? "-"} ${l.ttl_ms}`);
    },
    async openCommand(cwd, command) {
      calls.push(`open ${cwd} ${command}`);
      return { pane_id: "w9:p1" };
    },
    async pluginLinked() {
      return null;
    },
    async listPanes() {
      return [];
    },
    async closePane(id) {
      calls.push(`close pane ${id}`);
    },
    async closeTab(id) {
      calls.push(`close tab ${id}`);
    },
    async closeWorkspace(id) {
      calls.push(`close workspace ${id}`);
    },
    async openWorkspace(cwd, label, command, focus = true) {
      calls.push(`open workspace ${cwd} ${label} ${focus ? "focus" : "no-focus"} ${command}`);
      return { workspace_id: "w9", pane_id: "w9:p1" };
    },
    async reportWorkspace(id, tokens, ttl) {
      calls.push(`report workspace ${id} ${JSON.stringify(tokens)} ${ttl}`);
    },
    async moveWorkspace(id, index) {
      calls.push(`move workspace ${id} ${index}`);
    },
  };
  return { cockpit, calls };
}
