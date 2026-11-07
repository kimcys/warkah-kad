// The invitation builder's form, as pure functions (tested without a browser; the screens are src/screens/cards.js).
//   readValue / writeValue   a draft <-> what a form control shows and what a change sends (a JSON merge patch)
//   stepStats                missing items and problems per step, for the tabs
//   createAutosaver          collects edits, saves them after a pause, copes with a slow network and with another tab saving first
//   cardErrorMessage         what to tell the customer when the server says no
// What a valid card is lives in @warkah/card-kit (built from warkah-engine); this file only turns it into a form.
import { BUILDER_STEPS, LINES_AS_HTML, LINES_AS_LIST, addHours, cleanLines, fromIso, getPath, htmlToLines, linesToHtml, mergePatch, setPath, toIso } from "@warkah/card-kit";
import { t } from "./i18n.js";

export const END_AFTER_HOURS = 5;

/** The icons an event in the programme can have, in the order the form lists them (values are the card's own names). */
export const PROGRAMME_ICONS = ["jam", "pengantin", "makan", "akad", "doa", "bersurai"];
const ICON_LABELS = { jam: "Jam", pengantin: "Pengantin", makan: "Makan", akad: "Akad", doa: "Doa", bersurai: "Bersurai" };

/** The rows of a list field: which columns, the most rows, and what a blank row looks like. Built when asked, so the words follow the language. */
export function listShape(path) {
  if (path === "aturcara") {
    return {
      max: 12, addLabel: t("Tambah acara"), rowLabel: t("Acara"),
      blank: { icon: "jam", label: "", time: "" },
      columns: [
        { key: "icon", kind: "select", label: t("Ikon"), options: PROGRAMME_ICONS.map((value) => ({ value, label: t(ICON_LABELS[value]) })) },
        { key: "label", kind: "text", label: t("Acara"), max: 60, placeholder: t("Ketibaan Tetamu") },
        { key: "time", kind: "text", label: t("Masa"), max: 40, placeholder: "11:00 AM" }
      ]
    };
  }
  if (path === "contacts") {
    return {
      max: 6, addLabel: t("Tambah nama"), rowLabel: t("Untuk dihubungi"),
      blank: { name: "", role: "", phone: "" },
      columns: [
        { key: "name", kind: "text", label: t("Nama"), max: 60, placeholder: "Hjh. Rohani" },
        { key: "role", kind: "text", label: t("Hubungan"), max: 30, placeholder: t("Ibu") },
        { key: "phone", kind: "tel", label: t("Telefon"), max: 20, placeholder: "012-345 6789" }
      ]
    };
  }
  if (path === "dressCode.colors") {
    return {
      max: 8, addLabel: t("Tambah warna"), rowLabel: t("Warna"),
      blank: { label: "", tone: "blue", icon: "shirt" },
      columns: [
        { key: "label", kind: "text", label: t("Nama warna"), max: 40, placeholder: t("Biru Muda") },
        { key: "tone", kind: "select", label: t("Rona"), options: [{ value: "blue", label: t("Biru") }, { value: "pink", label: t("Merah jambu") }] },
        { key: "icon", kind: "select", label: t("Pakaian"), options: [{ value: "shirt", label: t("Baju lelaki") }, { value: "dress", label: t("Baju perempuan") }] }
      ]
    };
  }
  return null;
}

const isBlankRow = (row) => Object.entries(row).every(([key, v]) => key === "icon" || key === "tone" || String(v ?? "").trim() === "");   // a row where only the icon was touched is still empty

/** What a control shows for a field, taken from the draft. */
export function readValue(draft, field) {
  const stored = getPath(draft, field.path);
  switch (field.kind) {
    case "lines":
      if (LINES_AS_HTML.includes(field.path)) return htmlToLines(stored ?? "").join("\n");
      if (LINES_AS_LIST.includes(field.path)) return (Array.isArray(stored) ? stored : []).join("\n");
      return String(stored ?? "");
    case "datetime": return fromIso(stored) ?? { date: "", time: "" };
    case "list": return Array.isArray(stored) ? stored.map((row) => ({ ...row })) : [];
    case "number": return typeof stored === "number" ? stored : "";
    default: return stored === undefined || stored === null ? "" : String(stored);
  }
}

const nested = (path, value) => setPath({}, path, value);

/**
 * The merge patch a change sends, or null when there is nothing to send yet (a date without its time, say).
 * An emptied field becomes null, which removes it from the draft, so it counts as "missing" again.
 */
export function writeValue(draft, field, value) {
  switch (field.kind) {
    case "lines": {
      const lines = cleanLines(value);
      if (LINES_AS_HTML.includes(field.path)) return nested(field.path, lines.length ? linesToHtml(lines) : null);
      if (LINES_AS_LIST.includes(field.path)) return nested(field.path, lines.length ? lines : null);
      return nested(field.path, lines.length ? lines.join("\n") : null);
    }
    case "datetime": {
      const iso = toIso(value?.date, value?.time);
      if (!iso) return null;                                       // wait for both boxes
      if (field.path !== "date.start") return nested(field.path, iso);
      const end = getPath(draft, "date.end");
      const patch = nested("date.start", iso);
      if (!end || !(Date.parse(end) > Date.parse(iso))) patch.date.end = addHours(iso, END_AFTER_HOURS);   // the end follows the start until they set it themselves
      return patch;
    }
    case "list": {
      const rows = (Array.isArray(value) ? value : []).filter((row) => !isBlankRow(row));
      return nested(field.path, rows);
    }
    case "number": {
      const n = value === "" || value === null ? null : Number(value);
      return nested(field.path, Number.isFinite(n) ? n : null);
    }
    default: {
      const s = String(value ?? "");
      return nested(field.path, s.trim() === "" ? null : s);
    }
  }
}

/** A field is shown unless it belongs to a switch that is off. */
export const fieldVisible = (field, features) => !field.feature || features?.[field.feature] !== false;

export const stepFields = (step, features) => step.fields.filter((f) => fieldVisible(f, features));

/** The step a path belongs to (the longest field path that is a prefix of it). */
export function stepForPath(path) {
  let best = null;
  for (const step of BUILDER_STEPS) {
    for (const f of step.fields) {
      if ((path === f.path || path.startsWith(`${f.path}.`)) && (!best || f.path.length > best.len)) best = { id: step.id, len: f.path.length };
    }
  }
  if (best) return best.id;
  if (/^(portrait|gallery|cover)\b|^meta\./.test(path)) return "gambar";
  if (/^(gifts|duitnow|dressCode|ayat|features)\b/.test(path)) return "tambahan";
  if (/^music\b/.test(path)) return "gaya";
  return "terbit";
}

/** { pasangan: { missing: 2, problems: 0 }, ... } from the server's status block. */
export function stepStats(status) {
  const stats = Object.fromEntries(BUILDER_STEPS.map((s) => [s.id, { missing: 0, problems: 0 }]));
  for (const m of status?.missing ?? []) if (stats[m.step]) stats[m.step].missing++;
  for (const p of status?.problems ?? []) { const id = stepForPath(p.path); if (stats[id]) stats[id].problems++; }
  return stats;
}

export function progressText(status) {
  if (!status) return "";
  if (status.ready) return t("Semua sudah lengkap");
  const n = status.missing.length + status.problems.length;
  return t("{n} belum lengkap", { n });
}

/** "Disimpan 14:02", in Malaysia time. */
export function savedText(timestamp) {
  if (!timestamp) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(timestamp));
  return t("Disimpan {time}", { time: parts });
}

/** "22 Nov", in Malaysia time: when a preview link stops working. */
export function expiryText(timestamp) {
  if (!timestamp) return "";
  return t("Pautan sah sehingga {date}", { date: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short" }).format(new Date(timestamp)) });
}

/** What the preview panel should show for the server's preview state: one of none | working | ready | outdated | failed. */
export function previewPanelState(p) {
  if (!p) return "none";
  if (p.state === "queued" || p.state === "building") return "working";
  if (p.state === "failed") return "failed";
  if (p.state === "ready") return p.stale ? "outdated" : "ready";
  return "none";
}
export const previewWorking = (p) => previewPanelState(p) === "working";

/**
 * May the customer publish now? { ok, reason } where reason is what is in the way, in the order they would fix it:
 *   payment (an admin has not marked the card paid) | incomplete | preview (no preview of the card as it is now, or one is being built)
 */
export function publishGate({ card, status, preview }) {
  if (card?.status !== "paid" && card?.status !== "live") return { ok: false, reason: "payment" };
  if (!status?.ready) return { ok: false, reason: "incomplete" };
  if (!preview || preview.state === "queued" || preview.state === "building" || preview.state !== "ready" || preview.stale) return { ok: false, reason: "preview" };
  return { ok: true, reason: null };
}

/** none | working | live | changed (live, but edited since) | failed */
export function publishPanelState(p) {
  if (!p) return "none";
  if (p.state === "queued" || p.state === "building") return "working";
  if (p.state === "failed") return "failed";
  if (p.state === "live") return p.changed ? "changed" : "live";
  return "none";
}

/** Wording for what the server can answer to a save or an upload. */
export function cardErrorMessage(err) {
  const code = err?.code || "";
  const known = {
    not_in_tier: t("Ciri ini tidak termasuk dalam pakej anda."),
    not_offered: t("Ciri ini tidak ditawarkan buat masa ini."),
    stale: t("Kad ini telah diubah di tempat lain. Muat semula halaman."),
    not_editable: t("Kad ini tidak boleh diubah lagi."),
    card_limit: t("Anda sudah mempunyai tiga kad. Padam atau siapkan satu dahulu."),
    rate_limited: t("Terlalu banyak permintaan. Cuba sebentar lagi."),
    too_large: t("Fail terlalu besar."),
    unsupported_type: t("Jenis fail ini tidak diterima."),
    image_too_small: t("Gambar terlalu kecil. Pilih gambar yang lebih besar."),
    image_too_large: t("Gambar terlalu besar."),
    too_many: t("Sudah mencapai bilangan maksimum."),
    invalid_input: t("Maklumat tidak sah. Sila semak semula."),
    not_ready: t("Lengkapkan semua maklumat wajib dahulu."),
    payment_required: t("Kad ini belum diaktifkan. Hubungi kami untuk mengaktifkan pakej anda."),
    preview_required: t("Lihat pratonton terkini kad anda dahulu."),
    not_live: t("Kad ini tidak sedang diterbitkan."),
    invalid_slug: t("Alamat tidak sah."),
    slug_taken: t("Alamat ini sudah digunakan.")
  };
  if (known[code]) return known[code];
  if (err?.status === 401) return t("Sila log masuk semula.");
  if (err?.status >= 500) return t("Ralat pada pelayan. Cuba lagi sebentar.");
  return t("Tidak dapat menyimpan. Semak sambungan anda.");
}

// ---------- autosave

/**
 * Collects changes (merge patches) and saves them after a pause.
 *   save(patch, baseVersion)   does the request; throws an error with .status, .code and (for a 409) .body = the server's current card
 *   getVersion()               the version the browser last saw
 *   onSaved(result)            the server's answer to a good save (new version, status ...)
 *   onStale(body)              another tab or a file upload saved first: the browser's copy is behind
 *   onState({ state, ... })    idle | dirty | saving | saved | retrying | error | refused | conflict
 * A stale save is tried again at once on top of the newer version (edits to different fields do not clash); a network failure is retried
 * with a growing pause; a refusal (a 4xx that retrying cannot fix: not in the package, invalid input) is reported, not retried.
 */
export function createAutosaver({ save, getVersion, onSaved = (_result) => {}, onStale = (_body) => {}, onState = (_state) => {}, delay = 800, timers = { set: (f, ms) => setTimeout(f, ms), clear: (id) => clearTimeout(id) }, now = Date.now, backoff = [2000, 5000, 10000, 20000] }) {
  let pending = null, timer = null, running = null, state = "idle", lastSavedAt = null, retries = 0, staleRetries = 0;
  const set = (next, extra = {}) => { state = next; onState?.({ state, lastSavedAt, ...extra }); };
  const clear = () => { if (timer !== null) { timers.clear(timer); timer = null; } };
  const schedule = (ms) => { clear(); timer = timers.set(() => { timer = null; void run(); }, ms); };

  function change(patch) {
    pending = pending ? mergePatch(pending, patch) : patch;
    retries = 0; staleRetries = 0;
    set("dirty");
    schedule(delay);
  }

  function run() {
    if (running) return running;
    if (!pending) return Promise.resolve();
    const patch = pending;
    pending = null;
    set("saving");
    running = (async () => {
      try {
        const result = await save(patch, getVersion());
        lastSavedAt = now(); retries = 0; staleRetries = 0;
        onSaved?.(result);
        if (pending) { set("dirty"); schedule(0); } else set("saved");
      } catch (err) {
        pending = pending ? mergePatch(patch, pending) : patch;          // nothing is lost: it goes back in the queue
        if (err?.status === 409 && err?.code === "stale") {
          onStale?.(err.body);
          if (staleRetries++ < 2) { set("dirty"); schedule(0); } else set("conflict", { error: err });
        } else if (err?.status >= 400 && err?.status < 500 && err?.status !== 429 && err?.status !== 401 && err?.status !== 408) {
          pending = null;                                                // retrying cannot help; the screen puts the field back
          set("refused", { error: err, patch });
        } else if (retries < backoff.length) {
          set("retrying", { error: err, attempt: retries + 1 });
          schedule(backoff[retries++]);
        } else {
          set("error", { error: err });
        }
      } finally { running = null; }
    })();
    return running;
  }

  /** Saves what is waiting now, and resolves when nothing is left (or it cannot be saved). Used before leaving a step. */
  async function flush() {
    clear();
    for (let i = 0; i < 6; i++) {
      if (running) await running;
      else if (pending) await run();
      else break;
      if (state === "refused" || state === "conflict" || state === "error" || state === "retrying") { clear(); break; }
    }
    return state;
  }

  return {
    change, flush,
    retry() { retries = 0; staleRetries = 0; schedule(0); },
    get state() { return state; },
    get dirty() { return pending !== null || running !== null; },
    get pending() { return pending; },
    get lastSavedAt() { return lastSavedAt; }
  };
}

// ---------- pictures

/**
 * How to shrink a picked picture to fit an upload rule: the size to draw it at, or why it cannot be used.
 *   rule      { minLongEdge, maxLongEdge }  (from the kit's ASSET_RULES)
 *   square    gifts and QR codes are cut to a centred square
 */
export function planImage({ width, height }, rule, { square = false } = {}) {
  if (!(width > 0) || !(height > 0)) return { ok: false, reason: "unreadable" };
  const crop = square ? Math.min(width, height) : null;
  const w = square ? crop : width, h = square ? crop : height;
  const long = Math.max(w, h);
  if (rule.minLongEdge && long < rule.minLongEdge) return { ok: false, reason: "too_small" };
  const scale = rule.maxLongEdge && long > rule.maxLongEdge ? rule.maxLongEdge / long : 1;
  return {
    ok: true,
    scale,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    crop: square ? { x: Math.round((width - crop) / 2), y: Math.round((height - crop) / 2), size: crop } : null
  };
}

/** A gift's id: the lowest g1, g2 ... that no row and no stored file is using (a file of a deleted row may still be in the way). */
export function nextGiftId(rows, assetPaths = []) {
  const used = new Set([...rows.map((r) => r.id), ...assetPaths.map((p) => /^gifts\/(g\d+)\./.exec(p)?.[1])]);
  let n = 1;
  while (used.has(`g${n}`)) n++;
  return `g${n}`;
}

export const blankGift = (id) => ({ id, name: "", note: "", price: "", url: "" });

/** A gift row is "empty" while nothing but its id is filled in; empty rows are not saved. */
export const isBlankGift = (row) => ["name", "note", "price", "url"].every((k) => String(row[k] ?? "").trim() === "");

/** Moves one item of a list up or down (returns a new list). */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** A stored file's address with its upload time, so a replaced picture (same path) is fetched again, not shown from the cache. */
export const versionedUrl = (url, asset) => (asset?.createdAt ? `${url}?v=${asset.createdAt}` : url);

/**
 * The rows of the "choose what your card has" list: every feature the builder offers, whether it is on, and whether the package allows it.
 *   catalogue   the kit's features (OFFERED ones)   effective   effectiveFeatures(draft, tier)   tier   the tiers list with .features
 */
export function featureRows(features, effective, tier) {
  const allowedKeys = tier?.features === "all" ? null : new Set(tier?.features ?? []);
  const rows = features.map((f) => ({
    key: f.key, group: f.group, label: f.label, description: f.description,
    on: effective?.[f.key] === true,
    locked: allowedKeys !== null && !allowedKeys.has(f.key)
  }));
  return [...rows.filter((r) => r.group === "page"), ...rows.filter((r) => r.group === "addon")];
}
