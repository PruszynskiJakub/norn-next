import { KEY_PREFIX_PATTERN } from "@norn/plugin-api";
import { NonEmpty } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

export const DEFAULT_KEY_PREFIX = "lt";

export const LocalTrackerConfig = Type.Object(
  {
    /** the prefix of every key this tracker mints; `lt` when left out */
    keyPrefix: Type.Optional(Type.String({ pattern: KEY_PREFIX_PATTERN })),
    /** the folder holding one `<id>.md` per item; `<machine folder>/tracker` when left out */
    dir: Type.Optional(NonEmpty),
    /** who `whoami` names; `git config user.email` when left out */
    user: Type.Optional(NonEmpty),
  },
  { additionalProperties: false, title: "LocalTrackerConfig" },
);
export type LocalTrackerConfig = Static<typeof LocalTrackerConfig>;
