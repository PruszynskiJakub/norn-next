/** `norn story <verb>` (B2, B15, B16, B29, B33–B42): the stories of this repository — `list`, `view`, `chat`, and the team verbs `checkout`, `handoff`, `close`, `reopen`. */
import { defineNoun } from "../command.ts";
import { storyChatCommand } from "./story-chat.ts";
import { storyCheckoutCommand } from "./story-checkout.ts";
import { storyCloseCommand } from "./story-close.ts";
import { storyHandoffCommand } from "./story-handoff.ts";
import { storyListCommand } from "./story-list.ts";
import { storyReopenCommand } from "./story-reopen.ts";
import { storyViewCommand } from "./story-view.ts";

export const storyNoun = defineNoun({
  name: "story",
  summary: "The stories of this repository",
  verbs: [storyListCommand, storyViewCommand, storyChatCommand, storyCheckoutCommand, storyHandoffCommand, storyCloseCommand, storyReopenCommand],
});
