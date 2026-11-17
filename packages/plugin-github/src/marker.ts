/**
 * The receipt marker: how an issue, comment or pull request norn made carries the receipt id it was
 * made under, so the same effect performed again finds it instead of making a second one. GitHub
 * renders an HTML comment as nothing, so people never see it.
 */

/** Characters a receipt id may hold: enough for a ULID, none that could end the HTML comment early. */
export const RECEIPT_ID_PATTERN = "^[0-9A-Za-z_-]{1,64}$";
const RECEIPT_ID = new RegExp(RECEIPT_ID_PATTERN);
const ANY_MARKER = /\s*<!-- norn:receipt:[0-9A-Za-z_-]{1,64} -->/g;

export const isReceiptId = (id: string): boolean => RECEIPT_ID.test(id);

export const receiptMarker = (id: string): string => `<!-- norn:receipt:${id} -->`;

export function withMarker(body: string, id: string): string {
  return body ? `${body}\n\n${receiptMarker(id)}` : receiptMarker(id);
}

export const hasMarker = (body: string | null | undefined, id: string): boolean => (body ?? "").includes(receiptMarker(id));

/** The body as its author wrote it, markers taken out. */
export const stripMarkers = (body: string): string => body.replace(ANY_MARKER, "");

/** The markers in a body, kept across an edit so a replayed `open` still finds what it opened. */
export const markersIn = (body: string | null | undefined): string[] => (body ?? "").match(ANY_MARKER)?.map((m) => m.trim()) ?? [];
