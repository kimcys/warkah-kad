// Shrinks a picture in the browser before it is uploaded, so a 6 MB photo from a phone becomes the 200 KB the card needs.
// The rule (sizes, types) comes from the kit's ASSET_RULES; the size arithmetic is planImage in card-form.js (tested). This file only draws.
import { planImage } from "./card-form.js";

export class PrepError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const QUALITIES = [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4, 0.32];

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Which type to produce: the first the rule accepts, in the order we prefer (WebP is the smallest; JPEG for the share picture; PNG for QR codes). */
export function pickType(formats, prefer = ["image/webp", "image/jpeg", "image/png"]) {
  return prefer.find((f) => formats.includes(f)) || formats[0];
}

/**
 * file → { blob, name } that fits `rule`, or throws PrepError("unreadable" | "too_small" | "too_big").
 *   square   cut to a centred square (gift photos)
 *   keepPng  a QR code that is already a small PNG is sent as it is (re-compressing can blur the dots)
 */
export async function prepareImage(file, rule, { square = false } = {}) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new PrepError("unreadable"); }
  try {
    const plan = planImage({ width: bitmap.width, height: bitmap.height }, rule, { square });
    if (!plan.ok) throw new PrepError(plan.reason);
    if (rule.key === "qr" && file.type === "image/png" && file.size <= rule.maxBytes && !square && plan.scale === 1) return { blob: file, name: "qr.png" };
    const canvas = document.createElement("canvas");
    canvas.width = plan.width; canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (rule.formats.length && pickType(rule.formats) === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (plan.crop) ctx.drawImage(bitmap, plan.crop.x, plan.crop.y, plan.crop.size, plan.crop.size, 0, 0, plan.width, plan.height);
    else ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const type = pickType(rule.formats);
    for (const q of QUALITIES) {
      const blob = await toBlob(canvas, type, q);
      if (blob && blob.type === type && blob.size <= rule.maxBytes) return { blob, name: `photo.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}` };
      if (type === "image/png") break;           // quality does not apply to PNG
    }
    throw new PrepError("too_big");
  } finally { bitmap.close?.(); }
}

export const prepMessage = (code) => ({ unreadable: "Gambar ini tidak dapat dibaca.", too_small: "Gambar terlalu kecil. Pilih gambar yang lebih besar.", too_big: "Gambar terlalu besar walaupun dikecilkan. Cuba gambar lain." }[code]);
