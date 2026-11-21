/**
 * The reports an agent hands norn with an outcome. Each is a registered type with one place in the
 * run folder's `out/` and one shape, so `norn done` collects and validates it there, the brief names
 * both, and a refusal points at both. A step names a report by its type's name (`produces:
 * [findings]`); the name is the instance, and the type says where it goes and what it holds.
 */

/** `file`: one JSON file norn validates and keeps on the receipt; `folder`: files the agent names from another report. */
export type ReportRepresentation = "file" | "folder";

export interface ReportType {
  representation: ReportRepresentation;
  /** where it goes, relative to the run folder's `out/` */
  path: string;
  /** what it holds, in the words a brief and a refusal give the agent */
  shape: string;
  /** norn keeps it on the run's receipt; a report it does not keep lives only as long as the run folder */
  kept: boolean;
}

export const REPORT_TYPES = Object.freeze({
  criteria: {
    representation: "file",
    path: "criteria.json",
    shape:
      'a JSON array with one verdict per acceptance criterion, [{"id": "AC1", "verdict": "pass", "evidence": "..."}, ...]: pass needs evidence, fail repro, person how, unverified reason and how',
    kept: true,
  },
  findings: {
    representation: "file",
    path: "findings.json",
    shape: '{"findings": [...]} or the array alone, each finding with a "title" and a "severity" (blocking | major | minor | nit), and where it can "file", "line", "criterion", "detail" and "repro"',
    kept: true,
  },
  evidence: {
    representation: "folder",
    path: "evidence/",
    shape: "the files a criteria verdict's evidence names (output, logs, screenshots)",
    kept: false,
  },
} as const satisfies Record<string, ReportType>);

export type ReportName = keyof typeof REPORT_TYPES;
export const REPORT_NAMES: readonly ReportName[] = Object.freeze(Object.keys(REPORT_TYPES) as ReportName[]);

/** The env var the launch sets to the run folder's `out/`, as a brief and a refusal spell a report's place. */
export const OUT_ENV = "NORN_OUT";

/** Where a report goes, as the agent's shell spells it: `$NORN_OUT/findings.json`. */
export const reportPath = (name: ReportName): string => `$${OUT_ENV}/${REPORT_TYPES[name].path}`;
