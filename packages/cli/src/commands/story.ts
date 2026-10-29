/** `norn story <verb>` (B2, B15, B16, B28–B39): the stories of this repository — `list`, `view`, `chat`, `start` an attended step, `edit` mode or workflow, and the team verbs `checkout`, `handoff`, `close`. */
import { defineNoun } from "../command.ts";
import { storyChatCommand } from "./story-chat.ts";
import { storyCheckoutCommand } from "./story-checkout.ts";
import { storyCloseCommand } from "./story-close.ts";
import { storyEditCommand } from "./story-edit.ts";
import { storyHandoffCommand } from "./story-handoff.ts";
import { storyListCommand } from "./story-list.ts";
import { storyStartCommand } from "./story-start.ts";
import { storyViewCommand } from "./story-view.ts";

export const storyNoun = defineNoun({
  name: "story",
  summary: "The stories of this repository",
  verbs: [storyListCommand, storyViewCommand, storyChatCommand, storyStartCommand, storyEditCommand, storyCheckoutCommand, storyHandoffCommand, storyCloseCommand],
});
