/**
 * `norn story <verb>` (B2, B15–B39): the stories of this repository — `list`, `view`, `chat`, `create`,
 * the decisions `answer`, `approve`, `reject`, `update-branch`, `start` an attended step, `edit` mode or
 * workflow, and the team verbs `checkout`, `handoff`, `close`.
 */
import { defineNoun } from "../command.ts";
import { storyAnswerCommand } from "./story-answer.ts";
import { storyApproveCommand, storyRejectCommand } from "./story-approve.ts";
import { storyChatCommand } from "./story-chat.ts";
import { storyCheckoutCommand } from "./story-checkout.ts";
import { storyCloseCommand } from "./story-close.ts";
import { storyCreateCommand } from "./story-create.ts";
import { storyEditCommand } from "./story-edit.ts";
import { storyHandoffCommand } from "./story-handoff.ts";
import { storyListCommand } from "./story-list.ts";
import { storyStartCommand } from "./story-start.ts";
import { storyUpdateBranchCommand } from "./story-update-branch.ts";
import { storyViewCommand } from "./story-view.ts";

export const storyNoun = defineNoun({
  name: "story",
  summary: "The stories of this repository",
  verbs: [storyListCommand, storyViewCommand, storyChatCommand, storyCreateCommand, storyAnswerCommand, storyApproveCommand, storyRejectCommand, storyUpdateBranchCommand, storyStartCommand, storyEditCommand, storyCheckoutCommand, storyHandoffCommand, storyCloseCommand],
});
