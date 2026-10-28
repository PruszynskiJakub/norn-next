/** `norn story <verb>` (B2, B15, B16, B29): the stories of this repository — `list`, `view`, `chat`. */
import { defineNoun } from "../command.ts";
import { storyChatCommand } from "./story-chat.ts";
import { storyListCommand } from "./story-list.ts";
import { storyViewCommand } from "./story-view.ts";

export const storyNoun = defineNoun({
  name: "story",
  summary: "The stories of this repository",
  verbs: [storyListCommand, storyViewCommand, storyChatCommand],
});
