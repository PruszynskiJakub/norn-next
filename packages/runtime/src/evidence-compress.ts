/**
 * The evidence compressor: a pure function of a file's bytes and name. A screenshot is scaled to at most
 * 1600 px wide, aspect kept, and re-encoded as WebP at quality 80; anything it cannot shrink comes back
 * untouched, so compression never loses evidence.
 */
import decodeJpeg, { init as initJpeg } from "@jsquash/jpeg/decode";
import decodePng, { init as initPng } from "@jsquash/png/decode";
import resize, { initResize } from "@jsquash/resize";
import decodeWebp, { init as initWebpDecode } from "@jsquash/webp/decode";
import encodeWebp, { init as initWebpEncode } from "@jsquash/webp/encode";
import { wasmBase64 } from "./evidence-wasm.ts" with { type: "macro" };

export interface CompressedEvidence {
  /** the name the file is kept under: `<stem>.webp` once re-encoded, else the name it came with */
  name: string;
  bytes: Uint8Array;
  /** why an image was kept uncompressed, for `norn done`'s output; absent when nothing went wrong */
  message?: string;
}

const MAX_EVIDENCE_WIDTH = 1600;
const EVIDENCE_WEBP_QUALITY = 80;

/** The pixels the codecs pass around (their `ImageData`; the repo's lib has no DOM types). */
interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type Decode = (data: ArrayBuffer) => Promise<Pixels>;

const FORMATS: Record<string, { label: string; decode: Decode }> = {
  png: { label: "PNG", decode: (d) => decodePng(d) },
  jpg: { label: "JPEG", decode: (d) => decodeJpeg(d) },
  jpeg: { label: "JPEG", decode: (d) => decodeJpeg(d) },
  webp: { label: "WebP", decode: (d) => decodeWebp(d) },
};

const compile = (b64: string) => WebAssembly.compile(Buffer.from(b64, "base64"));

/**
 * The emscripten codecs take the compiled module first and their options second, which their typings
 * leave out. With a lone argument they take it for options, so the options always go too; `printErr`
 * keeps a decoder's complaint about an unreadable file off the caller's stderr (the message says it).
 */
type EmscriptenInit = (module: WebAssembly.Module, options: { printErr: () => void }) => Promise<unknown>;
const QUIET = { printErr: () => {} };
const withModule = (init: unknown, module: WebAssembly.Module) => (init as EmscriptenInit)(module, QUIET);

let codecs: Promise<void> | undefined;

/**
 * Every codec is given its compiled module before first use, once per process. The webp encoder picks
 * its SIMD glue by feature detection, so it must get the SIMD module (Bun on arm64 and x64 has SIMD).
 */
function loadCodecs(): Promise<void> {
  codecs ??= (async () => {
    const [png, jpeg, webpDec, webpEnc, rs] = await Promise.all([
      compile(wasmBase64("@jsquash/png/codec/pkg/squoosh_png_bg.wasm")),
      compile(wasmBase64("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm")),
      compile(wasmBase64("@jsquash/webp/codec/dec/webp_dec.wasm")),
      compile(wasmBase64("@jsquash/webp/codec/enc/webp_enc_simd.wasm")),
      compile(wasmBase64("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm")),
    ]);
    await Promise.all([initPng(png), withModule(initJpeg, jpeg), withModule(initWebpDecode, webpDec), withModule(initWebpEncode, webpEnc), initResize(rs)]);
  })();
  return codecs;
}

export async function compressEvidence(bytes: Uint8Array, name: string): Promise<CompressedEvidence> {
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > name.lastIndexOf("/") + 1;
  const format = hasExtension ? FORMATS[name.slice(dot + 1).toLowerCase()] : undefined;
  if (!format) return { name, bytes };
  await loadCodecs();
  let image: Pixels;
  try {
    image = await format.decode(bytes.slice().buffer);
  } catch {
    return { name, bytes, message: `${name} kept uncompressed: not a readable ${format.label}` };
  }
  if (image.width > MAX_EVIDENCE_WIDTH) {
    const height = Math.max(1, Math.round((image.height * MAX_EVIDENCE_WIDTH) / image.width));
    image = await resize(image, { width: MAX_EVIDENCE_WIDTH, height });
  }
  const webp = new Uint8Array(await encodeWebp(image, { quality: EVIDENCE_WEBP_QUALITY }));
  if (webp.length >= bytes.length) return { name, bytes };
  return { name: `${name.slice(0, dot)}.webp`, bytes: webp };
}
