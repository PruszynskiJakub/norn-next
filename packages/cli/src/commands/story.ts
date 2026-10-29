/** `norn story <verb>` (B2, B15, B16, B24–B27, B29, B33–B39): the stories of this repository — `list`, `view`, `chat`, the decisions `answer`, `approve`, `reject`, `update-branch`, and the team verbs `checkout`, `handoff`, `close`. */
import { defineNoun } from "../command.ts";
import { storyAnswerCommand } from "./story-answer.ts";
import { storyApproveCommand, storyRejectCommand } from "./story-approve.ts";
import { storyChatCommand } from "./story-chat.ts";
import { storyCheckoutCommand } from "./story-checkout.ts";
import { storyCloseCommand } from "./story-close.ts";
import { storyHandoffCommand } from "./story-handoff.ts";
import { storyListCommand } from "./story-list.ts";
import { storyUpdateBranchCommand } from "./story-update-branch.ts";
import { storyViewCommand } from "./story-view.ts";

export const storyNoun = defineNoun({
  name: "story",
  summary: "The stories of this repository",
  verbs: [storyListCommand, storyViewCommand, storyChatCommand, storyAnswerCommand, storyApproveCommand, storyRejectCommand, storyUpdateBranchCommand, storyCheckoutCommand, storyHandoffCommand, storyCloseCommand],
});
