// Child process for the concurrent-append test: append N receipts of mixed kinds.
import { ulid } from "@norn/schema";
import { appendReceipt } from "../../src/index.ts";

const [dir, count] = [process.argv[2] as string, Number(process.argv[3])];
for (let i = 0; i < count; i++) {
  const base = { receipt_id: ulid(), run_id: null, step: "implement", attempt: 1, at: "2026-10-23T12:00:00.000Z", by: "agent" as const };
  appendReceipt(dir, i % 2 ? { ...base, kind: "stuck", reason: "x" } : { ...base, kind: "ask", question: "?" });
}
