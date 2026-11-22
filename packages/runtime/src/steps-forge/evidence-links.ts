/**
 * The `evidence:<name>` links of a PR body, in image (`![alt](evidence:AC2.png)`) and plain
 * (`[text](evidence:AC1.md)`) form, and their resolution: a pure function of the body and the URL each
 * link resolves to. A link with no URL reads as text, so a reviewer never sees a broken image or a dead
 * link for evidence that was not published.
 */
import type { FileUrlForm } from "@norn/plugin-api";

/** A link as the body writes it: the name QA gave the file, and how it is shown. */
export interface EvidenceLink {
  name: string;
  form: FileUrlForm;
}

const LINK = /(!?)\[([^\]\n]*)\]\(evidence:([^)\s]+)\)/g;

function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Every evidence link of `text`, in order, repeats included. */
export function evidenceLinks(text: string): EvidenceLink[] {
  return [...text.matchAll(LINK)].map((m) => ({ name: decoded(m[3] as string), form: m[1] ? "image" : "link" }));
}

/** `text` with each evidence link pointed at `urlOf` its link, or read as text where that is null. */
export function resolveEvidenceLinks(text: string, urlOf: (link: EvidenceLink) => string | null): string {
  return text.replace(LINK, (_all, bang: string, label: string, raw: string) => {
    const link: EvidenceLink = { name: decoded(raw), form: bang ? "image" : "link" };
    const url = urlOf(link);
    if (url !== null) return `${bang}[${label}](${url})`;
    const said = label.trim();
    return `${said && said !== link.name ? `${said}: ` : ""}${link.name} (evidence not published)`;
  });
}
