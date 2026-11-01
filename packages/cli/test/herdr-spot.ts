/** A Herdr pane spot for tidy tests (unit and integration): `w<N>:t<N>.p<N>` names its workspace and tab. */
import type { herdr } from "@norn/adapters";

export const spot = (pane_id: string, cwd: string | null, status = "idle"): herdr.HerdrPaneSpot => {
  const [ws, rest] = pane_id.split(":") as [string, string];
  const tab = rest.startsWith("t") ? rest.split(".")[0] : "t1";
  return { pane_id, tab_id: `${ws}:${tab}`, workspace_id: ws, cwd, status };
};
