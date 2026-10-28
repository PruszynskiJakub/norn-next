/** `norn story <verb>` (B2, B15): the stories of this repository — `list` them. */
import { defineNoun } from "../command.ts";
import { storyListCommand } from "./story-list.ts";

export const storyNoun = defineNoun({
  name: "story",
  summary: "The stories of this repository",
  verbs: [storyListCommand],
});
