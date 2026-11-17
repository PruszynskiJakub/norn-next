/**
 * `git cat-file --batch` answers `<oid> blob <size>\n<content>\n` per object, where size counts
 * bytes. The host hands stdout over as text, so it is encoded back to bytes before slicing: slicing
 * the text by a byte count would cut a multi-byte character in half.
 */

/** Blob texts by id in the order asked, or a message naming what did not parse. */
export function parseCatFileBatch(stdout: string, shas: string[]): Map<string, string> | string {
  const bytes = new TextEncoder().encode(stdout);
  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  let pos = 0;
  for (const oid of shas) {
    const eol = bytes.indexOf(10, pos);
    if (eol < 0) return `cat-file ended before ${oid}`;
    const header = decoder.decode(bytes.subarray(pos, eol));
    const [got, type, size] = header.split(" ");
    if (got !== oid || type !== "blob" || size === undefined || !/^\d+$/.test(size)) return `cat-file answered ${JSON.stringify(header)} for ${oid}`;
    const start = eol + 1;
    const end = start + Number(size);
    if (bytes[end] !== 10) return end >= bytes.length ? `cat-file cut ${oid} short` : `cat-file framing broke after ${oid}`;
    out.set(oid, decoder.decode(bytes.subarray(start, end)));
    pos = end + 1;
  }
  return out;
}
