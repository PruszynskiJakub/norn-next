/**
 * Where a lab lives: one folder under the temp directory holding its repo, the bare remote the repo
 * pushes to, and a norn home of its own, so nothing of a person's repos or norn home is touched.
 */

/** The lab's folder under the temp directory a process is given. */
export function labRoot(tmpdir: string): string {
  return `${tmpdir.replace(/\/+$/, "")}/norn-lab`;
}

export interface LabPaths {
  root: string;
  /** the lab's checkout, where a person runs norn */
  repo: string;
  /** the bare remote the checkout pushes to, standing in for a code host */
  remote: string;
  /** the lab's own norn home: its NORN_HOME_DIR */
  home: string;
}

export function labPaths(tmpdir: string): LabPaths {
  const root = labRoot(tmpdir);
  return { root, repo: `${root}/repo`, remote: `${root}/remote.git`, home: `${root}/home` };
}

/**
 * The stand-in agent's beat script, in the lab's norn home: `norn lab-agent` reads it there when no
 * env names one, so a person's own `norn tick` or `norn watch` in the lab plays it too.
 */
export function labAgentBeatsFile(home: string): string {
  return `${home}/lab/agent-beats.json`;
}
