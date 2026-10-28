/** `norn story <verb>` (B2, B15–B42): one story — `create` it on the remote. */
import { defineNoun } from "../command.ts";
import { storyCreateCommand } from "./story-create.ts";

export const storyNoun = defineNoun({
  name: "story",
  summary: "Stories: create one on the remote and take it in",
  verbs: [storyCreateCommand],
});
