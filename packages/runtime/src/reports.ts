/**
 * The reports a `done` carries: read from the run folder's `out/`, where the agent writes them at the
 * place their registered type names (`REPORT_TYPES`), or from a file `norn done --criteria` and
 * `--findings` still name. Each is validated here and refused with its path and shape, never guessed
 * at: an unreadable or malformed report is refused even at an outcome that does not need it, as the
 * agent meant something by writing it.
 */
import { parseJson } from "@norn/plugin-api";
import { CriteriaReport, type CriterionVerdict, type Finding, REPORT_TYPES } from "@norn/schema";
import { Type } from "@sinclair/typebox";
import type { RuntimeEnv } from "./env.ts";
import { OUT_DIR, worktreeOf } from "./inputs.ts";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; do_instead: string; code: string };

export const CRITERIA_HINT = `write ${REPORT_TYPES.criteria.shape}; then report again`;
export const FINDINGS_HINT = `write ${REPORT_TYPES.findings.shape}; then report again`;

/** An array of findings or `{findings: [...]}`; each entry is checked and normalized one by one, so a refusal names the entry. */
const FindingsFile = Type.Union([Type.Array(Type.Unknown()), Type.Object({ findings: Type.Array(Type.Unknown()) })]);
const SEVERITIES: ReadonlySet<string> = new Set(["blocking", "major", "minor", "nit"]);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const invalid = <T>(error: string, do_instead: string, code: string): Parsed<T> => ({ ok: false, error, do_instead, code });

/** A criteria report's text, validated against `CriteriaReport`; `file` names it in a refusal. */
export function parseCriteria(raw: string, file: string): Parsed<CriterionVerdict[]> {
  const v = parseJson(CriteriaReport, raw, `criteria file ${file}`);
  return v.ok ? { ok: true, value: v.value } : invalid(v.failure.message, CRITERIA_HINT, "invalid_criteria");
}

/**
 * A findings report's text: a JSON array of findings, or `{findings: [...]}` as the review and qa
 * skills write it. Keys the receipt does not keep (a review's `axis`, `suggestion`) fold into
 * `detail`, so nothing the reviewer wrote is lost on the way to the rework.
 */
export function parseFindings(raw: string, file: string): Parsed<Finding[]> {
  const parsed = parseJson(FindingsFile, raw, `findings file ${file}`);
  if (!parsed.ok) return invalid(parsed.failure.message, FINDINGS_HINT, "invalid_findings");
  const held: unknown[] = Array.isArray(parsed.value) ? parsed.value : parsed.value.findings;
  const out: Finding[] = [];
  for (const [i, x] of held.entries()) {
    const o = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
    const severity = text(o.severity)?.toLowerCase();
    const title = text(o.title) ?? text(o.summary);
    if (severity === undefined || !SEVERITIES.has(severity) || title === undefined)
      return invalid(`finding ${i + 1} in ${file} needs a title and a severity (blocking | major | minor | nit)`, FINDINGS_HINT, "invalid_findings");
    const id = text(o.id);
    const where = text(o.file);
    const criterion = text(o.criterion) ?? (typeof o.criterion === "number" ? String(o.criterion) : undefined);
    const repro = text(o.repro);
    const detail = [text(o.detail), text(o.axis) && `Axis: ${text(o.axis)}`, text(o.suggestion) && `Suggestion: ${text(o.suggestion)}`].filter((d) => d).join("\n");
    out.push({
      ...(id !== undefined && { id }),
      severity: severity as Finding["severity"],
      ...(criterion !== undefined && { criterion }),
      ...(where !== undefined && { file: where }),
      ...(typeof o.line === "number" && Number.isInteger(o.line) && o.line > 0 && { line: o.line }),
      title,
      ...(detail !== "" && { detail }),
      ...(repro !== undefined && { repro }),
    });
  }
  return { ok: true, value: out };
}

export interface CollectedReports {
  criteria?: CriterionVerdict[];
  findings?: Finding[];
}

/**
 * The reports the run wrote to its `out/`, each one validated; a report it did not write is absent,
 * and one named in `given` (a file the command line named) is left unread. The refusal names the
 * report by its path in the worktree, the place the agent wrote it.
 */
export async function collectReports(env: RuntimeEnv, unit: string, given: { criteria?: boolean; findings?: boolean } = {}): Promise<Parsed<CollectedReports>> {
  const worktree = worktreeOf(env, unit);
  const read = async (path: string): Promise<Parsed<string | null>> => {
    try {
      return { ok: true, value: await env.ctx.files.read(`${worktree}/${path}`) };
    } catch (e) {
      return invalid(`${path} cannot be read: ${e instanceof Error ? e.message : String(e)}`, "report again with the same command", "unavailable");
    }
  };
  const out: CollectedReports = {};
  if (!given.criteria) {
    const path = `${OUT_DIR}/${REPORT_TYPES.criteria.path}`;
    const raw = await read(path);
    if (!raw.ok) return raw;
    if (raw.value !== null) {
      const c = parseCriteria(raw.value, path);
      if (!c.ok) return c;
      out.criteria = c.value;
    }
  }
  if (!given.findings) {
    const path = `${OUT_DIR}/${REPORT_TYPES.findings.path}`;
    const raw = await read(path);
    if (!raw.ok) return raw;
    if (raw.value !== null) {
      const f = parseFindings(raw.value, path);
      if (!f.ok) return f;
      out.findings = f.value;
    }
  }
  return { ok: true, value: out };
}
