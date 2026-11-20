/**
 * A red CI as an agent reads it: the receipt an await step wrote when it took `ci.failed`, and its
 * failed checks rendered the same way whatever forge reported them. The receipt's detail is validated
 * before it is read; one that does not validate renders as a red CI with no checks named.
 */
import type { KernelReceipt } from "@norn/kernel";
import { CiFailedData, check, type FailedCheck } from "@norn/schema";

/** Whether `r` is an await step's `ci.failed`, which every reader of a red check reads as one. */
export function isRedCi(r: KernelReceipt): boolean {
  return r.data.kind === "step.finished" && r.data.step_kind === "await" && r.data.outcome === "ci.failed";
}

/** The failed checks a red CI's receipt carries, as far as the forge could tell them. */
export function failedChecksOf(r: KernelReceipt): FailedCheck[] {
  const detail = r.data.kind === "step.finished" ? check(CiFailedData, r.data.detail) : undefined;
  return detail?.ok ? detail.value.failed : [];
}

/** One line per failed check with its link, its annotations as `path:line message` beneath. */
export function redCiText(r: KernelReceipt): string {
  const head = `CI failed on the change (\`${r.data.step ?? "ci"}\` ended \`ci.failed\`)`;
  const failed = failedChecksOf(r);
  if (failed.length === 0) return `${head}; the forge named no failed check.`;
  const lines = failed.flatMap((f) => [
    `- \`${f.name}\`${f.cancelled ? " (cancelled)" : ""}${f.url ? `: ${f.url}` : ""}`,
    ...f.annotations.map((a) => `  - ${a.path}${a.line !== undefined ? `:${a.line}` : ""} ${a.message}`.trimEnd()),
  ]);
  return `${head}:\n\n${lines.join("\n")}`;
}
