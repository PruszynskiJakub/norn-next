import { describe, expect, test } from "bun:test";
import encodeJpeg from "@jsquash/jpeg/encode";
import decodeWebp from "@jsquash/webp/decode";
import encodeWebp from "@jsquash/webp/encode";
import { compressEvidence } from "../../src/index.ts";
import { png } from "./images.ts";

const gradient = (x: number, y: number) => [x % 256, y % 256, (x + y) % 256];

/** The codecs read only these three fields of their `ImageData`; the repo's lib has no DOM types. */
function pixels(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...gradient(i % width, Math.floor(i / width)), 255], i * 4);
  return { data, width, height };
}

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await encodeJpeg(pixels(width, height), { quality: 90 }));
}

async function size(webp: Uint8Array): Promise<[number, number]> {
  const img = await decodeWebp(webp.slice().buffer);
  return [img.width, img.height];
}

const isWebp = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 4)) === "RIFF" && new TextDecoder().decode(b.slice(8, 12)) === "WEBP";

describe("compressEvidence (AC1): a screenshot scaled to 1600 px wide and re-encoded as WebP", () => {
  test("a 3200×1800 PNG becomes a 1600×900 WebP named <name>.webp, smaller than the original", async () => {
    const original = png(3200, 1800, gradient);
    const out = await compressEvidence(original, "AC1.png");
    expect(out.name).toBe("AC1.webp");
    expect(out.message).toBeUndefined();
    expect(isWebp(out.bytes)).toBe(true);
    expect(out.bytes.length).toBeLessThan(original.length);
    expect(await size(out.bytes)).toEqual([1600, 900]);
  });

  test("a 3200×1800 JPEG becomes a 1600×900 WebP", async () => {
    const original = await jpeg(3200, 1800);
    const out = await compressEvidence(original, "shot.jpeg");
    expect(out.name).toBe("shot.webp");
    expect(isWebp(out.bytes)).toBe(true);
    expect(await size(out.bytes)).toEqual([1600, 900]);
  });

  test("an image 1600 px wide or narrower keeps its size", async () => {
    for (const [w, h] of [
      [1600, 400],
      [1200, 700],
    ] as const) {
      const out = await compressEvidence(png(w, h, gradient), "AC2.png");
      expect(out.name).toBe("AC2.webp");
      expect(await size(out.bytes)).toEqual([w, h]);
    }
  });

  test("an upper-case extension and a name in a folder keep the stem", async () => {
    const out = await compressEvidence(png(800, 600, gradient), "shots/AC1.final.PNG");
    expect(out.name).toBe("shots/AC1.final.webp");
  });

  test("a WebP wider than 1600 px is scaled down too, under its own name", async () => {
    const original = new Uint8Array(await encodeWebp(pixels(2400, 1200), { quality: 100 }));
    const out = await compressEvidence(original, "wide.webp");
    expect(out.name).toBe("wide.webp");
    expect(await size(out.bytes)).toEqual([1600, 800]);
  });
});

describe("compressEvidence (AC2): nothing to gain, a GIF or a non-image comes back as it was", () => {
  test("a tiny flat PNG whose WebP would not be smaller keeps its bytes and name, with no message", async () => {
    const original = png(256, 256, () => [0], 0);
    const out = await compressEvidence(original, "AC2.png");
    expect(out).toEqual({ name: "AC2.png", bytes: original });
  });

  test("a .gif is never decoded: its bytes and name come back, with no message", async () => {
    const original = new TextEncoder().encode("GIF89a not decoded at all");
    expect(await compressEvidence(original, "AC2.gif")).toEqual({ name: "AC2.gif", bytes: original });
  });

  test("a non-image file comes back unchanged, with no message", async () => {
    const original = new TextEncoder().encode("# AC1\n\nlog\n");
    expect(await compressEvidence(original, "AC1.md")).toEqual({ name: "AC1.md", bytes: original });
    expect(await compressEvidence(original, "README")).toEqual({ name: "README", bytes: original });
  });
});

describe("compressEvidence (AC3): an image the codec cannot read is kept with a message", () => {
  test("AC3.png that is not a readable PNG", async () => {
    const original = new TextEncoder().encode("not a png at all");
    expect(await compressEvidence(original, "AC3.png")).toEqual({ name: "AC3.png", bytes: original, message: "AC3.png kept uncompressed: not a readable PNG" });
  });

  test("a broken JPEG and a broken WebP name their own format", async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect((await compressEvidence(junk, "a.jpg")).message).toBe("a.jpg kept uncompressed: not a readable JPEG");
    expect((await compressEvidence(junk, "b.webp")).message).toBe("b.webp kept uncompressed: not a readable WebP");
  });

  test("a PNG cut off halfway is unreadable too", async () => {
    const whole = png(64, 64, gradient);
    const cut = whole.slice(0, whole.length / 2);
    const out = await compressEvidence(cut, "AC3.png");
    expect(out).toEqual({ name: "AC3.png", bytes: cut, message: "AC3.png kept uncompressed: not a readable PNG" });
  });
});
