// Uploads for a card: what the file really is, whether it fits the rules, where it will sit in the card and what it changes in the draft.
// The rules (types, sizes, counts) come from the card kit's ASSET_RULES, the same list the builder shows next to each upload box.
import { ASSET_RULES, MIME, fileKind, imageInfo, type AssetRule } from "@warkah/card-kit";
import type { AssetRow, CardRow } from "./cards";

export type UploadError = "invalid_input" | "unsupported_type" | "too_large" | "image_too_small" | "image_too_large" | "too_many";
export const UPLOAD_STATUS: Record<UploadError, 400 | 409 | 413 | 415 | 422> = { invalid_input: 400, unsupported_type: 415, too_large: 413, image_too_small: 422, image_too_large: 422, too_many: 409 };

export const ruleFor = (kind: string): AssetRule | undefined => ASSET_RULES.find((r) => r.key === kind);

const EXT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", mp3: "mp3", m4a: "m4a" };

export interface Inspected { type: string; width: number | null; height: number | null; contentType: string }

/** Reads the real type from the bytes (never the name), then checks it against the rule. */
export function inspect(rule: AssetRule, bytes: Uint8Array): { ok: true; value: Inspected } | { ok: false; error: UploadError } {
  if (bytes.length === 0) return { ok: false, error: "invalid_input" };
  if (bytes.length > rule.maxBytes) return { ok: false, error: "too_large" };
  const type = fileKind(bytes);
  if (!type || !rule.formats.includes(MIME[type])) return { ok: false, error: "unsupported_type" };
  if (type === "mp3" || type === "m4a") return { ok: true, value: { type, width: null, height: null, contentType: MIME[type] } };
  const info = imageInfo(bytes);
  if (!info || info.animated) return { ok: false, error: "unsupported_type" };
  const longEdge = Math.max(info.width, info.height);
  if (rule.minLongEdge && longEdge < rule.minLongEdge) return { ok: false, error: "image_too_small" };
  if (rule.maxLongEdge && longEdge > rule.maxLongEdge) return { ok: false, error: "image_too_large" };
  return { ok: true, value: { type, width: info.width, height: info.height, contentType: MIME[type] } };
}

export interface Placement {
  path: string;
  /** Files of the same slot with another extension: they are replaced, so the old ones go. */
  replaces: AssetRow[];
  /** What the draft says about this file once it is stored. */
  apply: (draft: Record<string, any>) => void;
}

/** Where the file goes and what changes in the draft. `slot` is "groom" / "bride" for portraits and "g1".."g20" for gift photos. */
export function place(card: Pick<CardRow, "lang">, rule: AssetRule, slot: string | null, file: Inspected, assets: AssetRow[], draft: Record<string, any>): { ok: true; value: Placement } | { ok: false; error: UploadError } {
  const ext = EXT[file.type];
  const ofKind = assets.filter((a) => a.kind === rule.key);
  const single = (path: string, apply: Placement["apply"], sameSlot: (a: AssetRow) => boolean = () => true) => ({ ok: true as const, value: { path, apply, replaces: ofKind.filter((a) => sameSlot(a) && a.path !== path) } });
  switch (rule.key) {
    case "cover": {
      const path = `cover/og-preview.${ext}`;
      return single(path, (d) => { d.meta = { ...(d.meta ?? {}), ogImage: path, ogWidth: file.width, ogHeight: file.height }; });
    }
    case "portrait": {
      if (slot !== "groom" && slot !== "bride") return { ok: false, error: "invalid_input" };
      const path = `portrait/${slot}.${ext}`;
      return single(path, (d) => { d.portraits = { ...(d.portraits ?? {}), [slot]: path }; }, (a) => a.path.startsWith(`portrait/${slot}.`));
    }
    case "gallery": {
      if (ofKind.length >= (rule.max ?? 12)) return { ok: false, error: "too_many" };
      const used = new Set(ofKind.map((a) => Number(/^gallery\/(\d+)\./.exec(a.path)?.[1])));
      let n = 1;
      while (used.has(n)) n++;
      const path = `gallery/${n}.${ext}`;
      const alt = card.lang === "en" ? `Photo ${n}` : `Gambar ${n}`;
      return { ok: true, value: { path, replaces: [], apply: (d) => { d.gallery = [...(Array.isArray(d.gallery) ? d.gallery : []), { src: path, width: file.width, height: file.height, alt }]; } } };
    }
    case "gift": {
      if (!slot || !/^g\d{1,2}$/.test(slot)) return { ok: false, error: "invalid_input" };
      const path = `gifts/${slot}.webp`;               // the card looks for gifts/<id>.webp
      if (!ofKind.some((a) => a.path === path) && ofKind.length >= (rule.max ?? 20)) return { ok: false, error: "too_many" };
      return { ok: true, value: { path, replaces: [], apply: () => {} } };
    }
    case "qr": {
      const path = `duitnow/qr.${ext}`;
      return single(path, (d) => { d.duitnow = { ...(d.duitnow ?? {}), image: path }; });
    }
    case "music": {
      const path = `audio/song.${ext}`;
      return single(path, (d) => { d.music = { ...(d.music ?? {}), src: path, type: file.contentType }; });
    }
    default:
      return { ok: false, error: "invalid_input" };
  }
}

/** Takes away the draft's reference to a file that is being deleted. */
export function unreference(draft: Record<string, any>, asset: AssetRow): void {
  switch (asset.kind) {
    case "cover": if (draft.meta?.ogImage === asset.path) { delete draft.meta.ogImage; delete draft.meta.ogWidth; delete draft.meta.ogHeight; if (!Object.keys(draft.meta).length) delete draft.meta; } break;
    case "portrait": { const slot = asset.path.startsWith("portrait/groom.") ? "groom" : "bride"; if (draft.portraits?.[slot] === asset.path) { delete draft.portraits[slot]; if (!Object.keys(draft.portraits).length) delete draft.portraits; } break; }
    case "gallery": if (Array.isArray(draft.gallery)) { draft.gallery = draft.gallery.filter((g: any) => g?.src !== asset.path); if (!draft.gallery.length) delete draft.gallery; } break;
    case "qr": if (draft.duitnow?.image === asset.path) delete draft.duitnow.image; break;
    case "music": if (draft.music?.src === asset.path) { delete draft.music.src; delete draft.music.type; } break;
  }
}
