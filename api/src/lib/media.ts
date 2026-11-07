export type Container = "jpeg" | "png" | "webp" | "mp4" | "webm" | "ogg";
export type Family = "image" | "audio" | "video";

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

/** Identifies a file by its first bytes. The browser's Content-Type is a claim, not proof. */
export function sniff(b: Uint8Array): Container | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (ascii(b, 4, 8) === "ftyp") return "mp4";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  return null;
}

export const EXTENSION: Record<Container, string> = { jpeg: "jpg", png: "png", webp: "webp", mp4: "mp4", webm: "webm", ogg: "ogg" };

/** webm and mp4 hold either audio or video; the memory type decides which. */
export function contentTypeFor(c: Container, family: Family): string {
  if (c === "jpeg") return "image/jpeg";
  if (c === "png") return "image/png";
  if (c === "webp") return "image/webp";
  if (c === "ogg") return "audio/ogg";
  return `${family === "audio" ? "audio" : "video"}/${c}`;
}

/** Streams an R2 object, honouring Range (Safari will not play video without it). Returns null when the object is missing. */
export async function serveObject(bucket: R2Bucket, key: string, req: Request, cacheControl: string): Promise<Response | null> {
  const wantsRange = req.headers.has("Range");
  let obj: R2Object | R2ObjectBody | null;
  try {
    obj = await bucket.get(key, wantsRange ? { range: req.headers } : undefined);
  } catch {
    return new Response(null, { status: 416 });
  }
  if (!obj || !("body" in obj)) return null;

  const headers = new Headers({
    "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": cacheControl,
    ETag: obj.httpEtag
  });
  const r = wantsRange ? (obj.range as { offset?: number; length?: number; suffix?: number } | undefined) : undefined;
  if (r) {
    const offset = r.offset ?? Math.max(0, obj.size - (r.suffix ?? 0));
    const length = r.length ?? obj.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

export interface PngInfo {
  width: number;
  height: number;
  /** PNG colour type: 0 grey, 2 RGB, 3 palette, 4 grey + alpha, 6 RGB + alpha. */
  colorType: number;
  /** True when the picture can have see-through parts: an alpha channel, or a palette with transparency. */
  hasAlpha: boolean;
}

/** Reads a PNG's size and whether it can be transparent, from its first chunks. null if it is not a PNG. */
export function parsePng(b: Uint8Array): PngInfo | null {
  if (b.length < 33 || b[0] !== 0x89 || ascii(b, 1, 4) !== "PNG" || ascii(b, 12, 16) !== "IHDR") return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20), colorType = b[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  if (colorType === 3) {
    // palette image: transparent only if there is a tRNS chunk before the pixel data
    for (let i = 33; i + 8 <= b.length; ) {
      const len = view.getUint32(i), type = ascii(b, i + 4, i + 8);
      if (type === "tRNS") { hasAlpha = true; break; }
      if (type === "IDAT" || type === "IEND") break;
      i += 12 + len;
    }
  }
  return { width, height, colorType, hasAlpha };
}
