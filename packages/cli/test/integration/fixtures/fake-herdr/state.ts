/** The fake herdr's state file and where it keeps each pane's typed input and output (herdr.ts). */
import { dirname, join } from "node:path";

export interface HerdrPane {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  cwd: string;
  env: Record<string, string>;
  /** the process `pane run` started; absent: only the pane's shell runs */
  pid?: number;
  /** what `pane get` answers as `agent_status` (herdr reads it off the screen); absent: unknown */
  status?: string;
  /** what `pane read` shows; absent: the tail of the process's output */
  screen?: string;
}

export interface HerdrTab {
  tab_id: string;
  workspace_id: string;
  label: string;
}

export interface HerdrWorkspace {
  workspace_id: string;
  label: string;
}

export interface HerdrState {
  next: number;
  workspaces: HerdrWorkspace[];
  tabs: HerdrTab[];
  panes: HerdrPane[];
}

/** The pid process-info names as the pane's shell, which is never the agent's. */
export const SHELL_PID = 1;

/** Where a pane's typed input and its process's output go, beside the state file. */
export const inputPath = (state: string, pane: string): string => join(dirname(state), `herdr-input-${pane.replace(/[^A-Za-z0-9]/g, "_")}.log`);
export const outputPath = (state: string, pane: string): string => join(dirname(state), `herdr-output-${pane.replace(/[^A-Za-z0-9]/g, "_")}.log`);

