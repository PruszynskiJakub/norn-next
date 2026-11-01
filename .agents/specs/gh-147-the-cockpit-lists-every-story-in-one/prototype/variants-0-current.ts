/** PROTOTYPE (throwaway): variant 0 — today's cockpit, unchanged, as the baseline. */
import { handleKey, initialState, renderCockpit, type TuiState } from "/Users/jakubpruszynski/Projects/norn/packages/cli/src/runtime/cockpit-tui.ts";
import type { Variant } from "../shared.ts";

export const current: Variant<TuiState> = {
  key: "0",
  name: "today",
  init: () => initialState(),
  handle(s, key, model, look) {
    const { state, effect } = handleKey(s, key, model, look);
    if (effect?.kind === "run") return { state, effect };
    if (effect?.kind === "quit") return { state, effect };
    return { state };
  },
  frame: (model, s, look) => renderCockpit(model, look.toast ? { ...s, message: { text: look.toast, tone: "ok" } } : s, look),
};

