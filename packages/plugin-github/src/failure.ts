/**
 * Turning a failed `gh` call into a PluginFailure. gh says why only in prose on stderr, so the
 * patterns are the one place that prose is read; anything they miss is `unknown` and never retried
 * blindly, because a call reported as done when it was not is worse than one reported as failed.
 */
import { type ExecOutput, fail, type PluginFailure, type PluginResult } from "@norn/plugin-api";

const RATE = /rate limit|HTTP 429|abuse detection/i;
const AUTH = /gh auth login|not logged in|authentication required|requires authentication|bad credentials|HTTP 401|HTTP 403|resource not accessible|GH_TOKEN|GITHUB_TOKEN/i;
/** gh refuses an unknown label by name before it changes anything, so it is a bad request, not a missing item */
const LABEL = /could not add label|'[^']*' not found/i;
const EXISTS = /already exists/i;
const NETWORK = /error connecting to|could not resolve host|connection (refused|reset|timed out)|network is unreachable|i\/o timeout|tls handshake|HTTP 5\d\d|bad gateway|service unavailable|unexpected EOF/i;
/**
 * GitHub answers the same for a misspelt repository and a private one the token cannot see, so it is
 * never read as a missing item: that would turn lost access into "no such issue" for every id.
 */
const NO_REPOSITORY = /could not resolve to a repository/i;
const NOT_FOUND = /could not resolve to an? |could not resolve to the |HTTP 404|no pull requests? found|not found/i;
/** The one answer that says a numbered issue is absent from a repository gh did reach. */
const NO_ISSUE = /could not resolve to an issue or pull request with the number/i;
const INVALID = /HTTP 422|validation failed|unknown flag|invalid argument/i;

/** The failure a non-zero, timed-out or unstartable `gh` call stands for. */
export function classify(out: ExecOutput, what: string): PluginResult<never> {
  const text = `${out.stderr}\n${out.stdout}`.trim();
  const msg = `${what} failed (exit ${out.code}): ${text.slice(0, 400) || "no output"}`;
  if (out.timedOut) return fail("unavailable", `${what} timed out`);
  // a missing binary needs someone to install it; retrying changes nothing
  if (out.code === 127) return fail("unavailable", msg, false);
  if (RATE.test(text)) return fail("rate_limited", msg);
  if (AUTH.test(text)) return fail("auth", msg);
  if (LABEL.test(text)) return fail("invalid", msg);
  if (EXISTS.test(text)) return fail("conflict", msg);
  if (NETWORK.test(text)) return fail("unavailable", msg);
  if (NO_REPOSITORY.test(text)) return fail("auth", `${msg} (the repository is misnamed or this token cannot see it)`, false);
  if (NOT_FOUND.test(text)) return fail("not_found", msg);
  if (INVALID.test(text)) return fail("invalid", msg);
  return fail("unknown", msg);
}

/**
 * Whether a failure says only that the issue asked for does not exist. Other not_found answers (an
 * unreachable repository, a 404 from an unrelated endpoint) stay failures, never an absent issue.
 */
export function isMissingIssue(failure: PluginFailure): boolean {
  return failure.code === "not_found" && NO_ISSUE.test(failure.message);
}
