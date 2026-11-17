import { type Static, Type } from "@sinclair/typebox";

export const GitVcsConfig = Type.Object(
  {
    /** the remote pushes and fetches go to; absent: `origin` */
    remote: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
export type GitVcsConfig = Static<typeof GitVcsConfig>;
