/** Image fixtures for the evidence tests, built in memory. */
import { deflateSync } from "node:zlib";

/**
 * A PNG built by hand: one IHDR, one IDAT, IEND. Colour type 0 (grey) or 2 (RGB), 8 bits, no filter.
 * Hand-built rather than encoded, so a flat grey image packs tighter than the WebP the codec writes for it.
 */
export function png(width: number, height: number, pixel: (x: number, y: number) => number[], colour: 0 | 2 = 2): Uint8Array {
  const channels = colour === 0 ? 1 : 3;
  const raw = new Uint8Array(height * (1 + width * channels));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * channels);
    for (let x = 0; x < width; x++) raw.set(pixel(x, y).slice(0, channels), row + 1 + x * channels);
  }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, Bun.hash.crc32(body));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, colour, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())];
  return new Uint8Array(parts.flatMap((p) => [...p]));
}
