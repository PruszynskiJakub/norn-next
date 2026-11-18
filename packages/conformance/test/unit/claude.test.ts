/**
 * Conformance of the Claude Code harness to the session contract, end to end: recorded native hook
 * calls go through claudeHarness.normalize into the kernel's reducer and classifier, and each
 * scenario pins the activity a host would read at given instants. In-process only: a unit test.
 */
import { harnessConformance } from "@norn/conformance";
import { claudeHarness } from "@norn/harness-claude";
import { loadRecordings, SILENT_AFTER_MS } from "./recordings.ts";

harnessConformance("claude", claudeHarness, loadRecordings("claude"), { silentAfterMs: SILENT_AFTER_MS });

// The degraded reads are judged by capability: the claude harness claiming it reports no limits or no
// subagents, while its recordings show them, must break exactly those reads, so the suite is shown
// to catch a harness whose capabilities misstate what it sends.
harnessConformance("claude claiming no limits", { ...claudeHarness, capabilities: { ...claudeHarness.capabilities, limits: false } }, loadRecordings("claude"), {
  silentAfterMs: SILENT_AFTER_MS,
  failing: {
    "usage-limit: without limits: none of its events, and never its activity": "the recording hits a usage limit",
    "usage-limit: without limits, the situation still reads as a wait with a reason, never as a silent agent": "the recording goes silent once the reset passes",
  },
});

harnessConformance("claude claiming no subagents", { ...claudeHarness, capabilities: { ...claudeHarness.capabilities, subagents: false } }, loadRecordings("claude"), {
  silentAfterMs: SILENT_AFTER_MS,
  failing: { "background-subagents: without subagents: none of its events, and never its activity": "the recording starts two subagents" },
});
