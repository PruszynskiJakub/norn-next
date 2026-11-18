import { type Static, Type } from "@sinclair/typebox";

/** `OWNER/NAME` as `gh -R` takes it. */
export const REPO_PATTERN = "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$";

export const GithubConfig = Type.Object(
  {
    /** the repository to act on; left out, the one `gh repo view` names for the checkout */
    repo: Type.Optional(Type.String({ pattern: REPO_PATTERN })),
  },
  { additionalProperties: false },
);
export type GithubConfig = Static<typeof GithubConfig>;
