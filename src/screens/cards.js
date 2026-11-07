// The invitation builder, at /app/cards: a customer's cards, starting a new one, and the editor (six steps, autosave, a phone preview).
// It plugs into the couple's account page (src/screens/account.js route()): same sign-in, same page frame, same API client.
// What is a valid card, what is missing and what each step asks comes from @warkah/card-kit; the rules of the form are in lib/card-form.js.
import "../cards.css";
import { ASSET_RULES, effectiveFeatures, isNoop, mergePatch, suggestSlug } from "@warkah/card-kit";
import { h, icon, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { openSheet } from "../lib/sheet.js";
import { isSignedOut } from "../lib/session.js";
import { cardErrorMessage, createAutosaver, expiryText, publishGate, publishPanelState, previewPanelState, previewWorking, nextGiftId, versionedUrl, progressText, readValue, savedText, stepFields, stepStats, writeValue } from "../lib/card-form.js";
import { culturePill, renderField, themePicker } from "../lib/card-fields.js";
import { featureToggles, galleryField, giftsField, imageBox } from "../lib/card-media.js";
import { PrepError, prepMessage, prepareImage } from "../lib/image-prep.js";

const MAX_CARDS = 3;
const STATUS_LABEL = { draft: "Draf", paid: "Dibayar", live: "Diterbitkan", archived: "Diarkibkan" };
const SECTION_HEADINGS = {
  "couple.groom.name": "Pengantin lelaki", "couple.bride.name": "Pengantin perempuan", "couple.first": "Susunan nama", "host.parents": "Yang menjemput",
  "date.start": "Tarikh dan masa", "venue.name": "Tempat", "aturcara": "Atur cara majlis", "contacts": "Untuk dihubungi", "rsvp.maxGuests": "RSVP",
  "ayat.ref": "Ayat Al-Quran", "gifts.items": "Senarai hadiah", "duitnow.image": "DuitNow", "dressCode.colors": "Tema warna / pakaian",
  "theme": "Tema", "palette": "Warna", "couple.model.groom": "Pengantin di dalam kad", "music.src": "Muzik latar"
};

/** /app/cards, /app/cards/new, /app/cards/<id>, /app/cards/<id>/<step> */
export function cardsView(ctx, rest = []) {
  const [a, b] = rest;
  if (!a) return cardsHome(ctx);
  if (a === "new") return newCard(ctx);
  return cardEditor(ctx, a, b);
}

const failed = (ctx, e, retry, title = t("Kad saya")) => {
  if (isSignedOut(e)) return ctx.signIn();
  console.error(e);
  ctx.show(ctx.page(ctx.header(title, () => ctx.go("/app/cards")), h("p", { class: "err center pad2" }, e?.status === 404 ? t("Kad ini tidak ditemui.") : t("Tidak dapat memuatkan kad anda.")), h("div", { class: "page-pad" }, h("button", { class: "btn light", onclick: retry }, t("Cuba lagi")))));
};

/* ---------- the customer's cards ---------- */

async function cardsHome(ctx) {
  const { api, show, page, header, waiting, go, wide } = ctx;
  show(waiting(t("Kad saya")));
  let cards, catalogue;
  try { [cards, catalogue] = await Promise.all([api.listCards(), api.loadCatalogue()]); } catch (e) { return failed(ctx, e, () => cardsHome(ctx)); }
  const themeName = (key) => catalogue.themes.find((x) => x.key === key)?.label.ms || "";
  const row = (c) => h("article", { class: "cd-mine" },
    h("div", { class: "cd-top" }, h("h2", {}, c.names || t("Kad tanpa nama")), h("span", { class: `cd-badge ${c.status}` }, t(STATUS_LABEL[c.status] || c.status))),
    h("p", { class: "muted" }, [c.theme ? themeName(c.theme) : t("Tema belum dipilih"), `/${c.slug}`].join(" · ")),
    h("div", { class: "bar-prog", role: "img", "aria-label": progressText({ ready: c.ready, missing: Array(Math.max(0, c.completeness.total - c.completeness.done)), problems: [] }) }, h("i", { style: `width:${c.completeness.total ? Math.round((100 * c.completeness.done) / c.completeness.total) : 0}%` })),
    h("p", { class: "muted cd-small" }, c.ready ? t("Semua sudah lengkap") : t("{done} daripada {total} siap", c.completeness)),
    h("button", { class: "btn primary slim", onclick: () => go(`/app/cards/${c.id}`) }, c.completeness.done ? t("Teruskan") : t("Mula")));
  const listPage = wide(page(
    header(t("Kad saya")),
    cards.length ? h("div", { class: "cd-list" }, ...cards.map(row)) : h("div", { class: "cd-empty" }, h("h2", {}, t("Cipta kad jemputan pertama anda")), h("p", { class: "muted" }, t("Isi maklumat, pilih tema, warna dan pengantin, dan lihat contohnya terus."))),
    cards.length >= MAX_CARDS
      ? h("div", { class: "page-pad" }, h("p", { class: "muted center" }, t("Anda sudah mempunyai tiga kad, had satu akaun.")))
      : h("div", { class: "page-pad" }, h("button", { class: "btn primary", onclick: () => go("/app/cards/new") }, icon("plus"), t("Cipta kad baharu")))));
  listPage.classList.add("cdx");
  show(listPage);
}

/* ---------- a new card: the language, then the theme ---------- */

async function newCard(ctx) {
  const { api, show, page, header, waiting, go, wide } = ctx;
  show(waiting(t("Kad baharu")));
  let catalogue;
  try { catalogue = await api.loadCatalogue(); } catch (e) { return failed(ctx, e, () => newCard(ctx), t("Kad baharu")); }
  let lang = "ms";
  const err = h("p", { class: "err center", role: "alert" });
  const langBtn = (code, label) => h("button", { type: "button", class: `cd-chip${lang === code ? " on" : ""}`, role: "radio", "aria-checked": String(lang === code), onclick: () => { lang = code; drawLang(); picker.set(null); } }, label);
  const langRow = h("div", { class: "cd-palettes", role: "radiogroup", "aria-label": t("Bahasa kad") });
  const drawLang = () => langRow.replaceChildren(langBtn("ms", "Bahasa Malaysia"), langBtn("en", "English"));
  drawLang();
  const picker = themePicker({
    themes: catalogue.themes, value: null,
    onPick: async (theme) => {
      err.textContent = "";
      try { const made = await api.createCard({ lang, theme }); go(`/app/cards/${made.card.id}/pasangan`); } catch (e) {
        if (isSignedOut(e)) return ctx.signIn();
        err.textContent = cardErrorMessage(e);
        picker.set(null);
      }
    }
  });
  const newPage = wide(page(
    header(t("Kad baharu"), () => go("/app/cards")),
    h("div", { class: "cd-new" },
      h("section", {}, h("h2", {}, t("Bahasa kad")), h("p", { class: "muted" }, t("Perkataan tetap dalam kad (butang, tajuk, mesej) akan ditulis dalam bahasa ini. Apa yang anda taip kekal seperti yang ditulis.")), langRow),
      h("section", {}, h("h2", {}, t("Pilih tema")), h("p", { class: "muted" }, t("Anda boleh menukar tema dan warna kemudian. Apa yang telah ditaip tidak hilang.")), picker.node, err))));
  newPage.classList.add("cdx");
  show(newPage);
}

/* ---------- the editor ---------- */

async function cardEditor(ctx, id, stepId) {
  const { api, show, page, header, waiting, go, wide } = ctx;
  show(waiting(t("Kad saya")));
  let catalogue, loaded;
  try { [catalogue, loaded] = await Promise.all([api.loadCatalogue(), api.getCard(id)]); } catch (e) { return failed(ctx, e, () => cardEditor(ctx, id, stepId)); }

  const model = { card: loaded.card, draft: loaded.draft, status: loaded.status, assets: loaded.assets, allowed: loaded.allowed, version: loaded.card.version };
  const steps = catalogue.steps;
  const themeEntry = () => catalogue.themes.find((x) => x.key === model.draft.theme);
  const features = () => effectiveFeatures(model.draft, model.card.tier);   // worked out here, so a switch shows or hides its fields at once
  let step = steps.find((s) => s.id === stepId) || steps.find((s) => stepStats(model.status)[s.id]?.missing) || steps[0];

  // ----- saving
  const pill = h("span", { class: "savepill", role: "status", "aria-live": "polite" });
  const showState = ({ state, lastSavedAt, error }) => {
    const retry = h("button", { type: "button", class: "linkbtn", onclick: () => saver.retry() }, t("Cuba lagi"));
    const text = { idle: [savedText(lastSavedAt)], dirty: [t("Perubahan belum disimpan…")], saving: [t("Menyimpan…")], saved: [savedText(lastSavedAt) || t("Disimpan")], retrying: [t("Tiada sambungan. Mencuba semula…")],
      error: [t("Tidak dapat menyimpan. "), retry], refused: [cardErrorMessage(error)], conflict: [t("Kad ini diubah di tempat lain. "), h("button", { type: "button", class: "linkbtn", onclick: () => reload() }, t("Muat semula"))] }[state] || [""];
    pill.className = `savepill ${state}`;
    pill.replaceChildren(...text);
    if (state === "refused") { toast(cardErrorMessage(error), "alert"); void reload(); }
  };
  const saver = createAutosaver({
    save: (patch, version) => api.saveCard(id, version, patch),
    getVersion: () => model.version,
    onSaved: (r) => { model.version = r.version; model.status = r.status; model.card = r.card; paintChrome(); showProblems(); },
    onStale: (body) => { if (body?.card) { model.version = body.card.version; model.draft = mergePatch(body.draft, saver.pending ?? {}); } },
    onState: showState
  });
  window.addEventListener("beforeunload", function guard(e) { if (!view.isConnected) return window.removeEventListener("beforeunload", guard); if (saver.dirty) { e.preventDefault(); e.returnValue = ""; } });

  const commit = (patch) => {
    if (!patch || isNoop(model.draft, patch)) return;
    model.draft = mergePatch(model.draft, patch);
    saver.change(patch);
    preview.update(previewState());
    if (sheetPreview) sheetPreview.update(previewState());
  };
  const changeField = (field) => (value) => commit(writeValue(model.draft, field, value));

  async function reload() {
    try {
      const fresh = await api.getCard(id);
      Object.assign(model, { card: fresh.card, draft: fresh.draft, status: fresh.status, assets: fresh.assets, allowed: fresh.allowed, version: fresh.card.version });
      paintChrome(); drawStep(); preview.update(previewState());
    } catch (e) { if (isSignedOut(e)) ctx.signIn(); else toast(cardErrorMessage(e), "alert"); }
  }

  // ----- the phone preview: a prebuilt sample card of the chosen theme; colours and figures switch at once (same origin, no reload)
  const previewState = () => ({ theme: model.draft.theme, lang: model.card.lang, palette: model.draft.palette, groom: model.draft.couple?.model?.groom, bride: model.draft.couple?.model?.bride });
  function previewFrame({ always = false } = {}) {
    const badge = h("span", { class: "cd-badge" }, t("Contoh"));
    const frame = h("iframe", { class: "cd-frame", title: t("Contoh kad"), tabindex: "-1" });
    const empty = h("p", { class: "cd-empty-note muted" }, t("Pilih tema untuk melihat contoh kad anda."));
    const node = h("div", { class: "cd-phone" }, badge, frame, empty);
    let key = "", latest = {}, defaults = {};
    const apply = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc?.documentElement) return;
        doc.documentElement.dataset.palette = latest.palette || "classic";
        for (const who of ["groom", "bride"]) {
          const img = doc.querySelector(`.mempelai-${who} .model-figure img`);
          if (!img) continue;
          defaults[who] ??= img.getAttribute("src");
          const base = defaults[who].replace(/[^/]+$/, "");
          img.setAttribute("src", latest[who] ? `${base}${latest[who]}.webp` : defaults[who]);
        }
      } catch { /* a cross-origin or not-yet-loaded frame: the next load applies it */ }
    };
    frame.addEventListener("load", () => { defaults = {}; apply(); });
    return {
      node,
      update(s) {
        latest = s;
        node.classList.toggle("none", !s.theme);
        if (!s.theme) return;
        if (!always && !matchMedia("(min-width: 900px)").matches) return;   // the side panel is hidden on a phone: its frame would never load
        const next = `${s.theme}-${s.lang}`;
        if (next !== key) { key = next; frame.src = `/preview/${next}/`; } else apply();
      }
    };
  }
  const preview = previewFrame();
  matchMedia("(min-width: 900px)").addEventListener?.("change", () => preview.update(previewState()));
  let sheetPreview = null;

  // ----- the page
  const view = h("div", { class: "cd cdx" });
  const tabs = h("nav", { class: "cd-tabs", "aria-label": t("Langkah") });
  const form = h("section", { class: "cd-form" });
  const progress = h("span", { class: "progress" });
  const prev = h("button", { type: "button", class: "btn light slim", onclick: () => move(-1) }, t("Sebelumnya"));
  const next = h("button", { type: "button", class: "btn primary slim", onclick: () => move(1) }, t("Seterusnya"));
  const showPreview = h("button", { type: "button", class: "btn cream slim cd-showpreview", onclick: () => { openSheet((close) => { sheetPreview = previewFrame({ always: true }); sheetPreview.update(previewState()); const wrap = h("div", { class: "cd-sheet cdx" }, h("button", { class: "iconbtn cd-small close", "aria-label": t("Tutup"), onclick: () => { sheetPreview = null; close(); } }, icon("close")), sheetPreview.node); return wrap; }); } }, icon("eye"), t("Lihat contoh"));
  const title = h("span", {});

  function paintChrome() {
    const stats = stepStats(model.status);
    tabs.replaceChildren(...steps.map((s, i) => {
      const st = stats[s.id], n = (st?.missing ?? 0) + (st?.problems ?? 0);
      return h("button", { type: "button", class: `cd-tab${s.id === step.id ? " on" : ""}`, "aria-current": s.id === step.id ? "step" : undefined, onclick: () => goStep(s.id) },
        h("span", { class: "no" }, String(i + 1)), h("span", { class: "tt" }, t(s.title)), n && s.id !== "terbit" ? h("span", { class: "cd-dot", title: t("{n} belum lengkap", { n }) }, String(n)) : null);
    }));
    progress.textContent = progressText(model.status);
    progress.classList.toggle("done", !!model.status?.ready);
    title.textContent = model.card.names || t("Kad baharu");
    const i = steps.findIndex((s) => s.id === step.id);
    prev.disabled = i <= 0;
    next.textContent = i >= steps.length - 1 ? t("Selesai") : t("Seterusnya");
    next.hidden = i >= steps.length - 1;
  }

  async function goStep(stepIdNext) {
    const state = await saver.flush();
    if (["error", "retrying", "conflict"].includes(state)) { toast(t("Perubahan anda belum disimpan. Semak sambungan, kemudian cuba lagi."), "alert"); return; }
    step = steps.find((s) => s.id === stepIdNext) || steps[0];
    history.pushState({}, "", `/app/cards/${id}/${step.id}`);
    paintChrome(); drawStep(); window.scrollTo(0, 0);
  }
  const move = (d) => { const i = steps.findIndex((s) => s.id === step.id) + d; if (steps[i]) void goStep(steps[i].id); };

  // ----- one step of the form
  const errors = new Map();   // path -> setError
  const showProblems = () => {
    for (const [path, set] of errors) {
      const p = (model.status?.problems ?? []).filter((x) => x.path === path || x.path.startsWith(`${path}.`));
      set(p.map((x) => x.message).join(" "));
    }
  };

  function drawStep() {
    errors.clear();
    if (step.id !== "terbit") stopPolling();
    if (step.id === "terbit") return drawSummary();
    const nodes = [];
    let intro = null;
    for (const field of stepFields(step, features())) {
      const heading = SECTION_HEADINGS[field.path];
      if (heading) nodes.push(h("h2", { class: "sec" }, t(heading)));
      const control = control_(field);
      if (control) { nodes.push(control.node); if (control.setError) errors.set(field.path, control.setError); }
    }
    form.replaceChildren(...[h("h1", { class: "stephead" }, t(step.title)), intro, ...nodes].filter(Boolean));
    showProblems();
  }

  // ----- pictures: shrink in the browser, upload, then show what the server now has
  const media = {
    rule: (kind) => ASSET_RULES.find((r) => r.key === kind),
    asset: (path) => model.assets.find((a) => a.path === path),
    url: (asset) => versionedUrl(api.cardFileUrl(id, asset.path), asset),
    nextGiftId: (rows) => nextGiftId(rows, model.assets.map((a) => a.path)),
    message: (e) => (e instanceof PrepError ? t(prepMessage(e.code)) : cardErrorMessage(e)),
    refresh: () => reload(),
    async upload(kind, file, { slot, square = false, reload: again = true, before } = {}) {
      const prepared = await prepareImage(file, media.rule(kind), { square });
      before?.();
      const state = await saver.flush();
      if (state !== "saved" && state !== "idle") throw Object.assign(new Error("not saved"), { code: "not_saved" });
      await api.uploadCardAsset(id, kind, new File([prepared.blob], prepared.name, { type: prepared.blob.type }), slot);
      if (again) await reload();
    },
    async remove(asset) { await saver.flush(); await api.deleteCardAsset(id, asset.id); await reload(); }
  };
  const tierEntry = () => catalogue.tiers.find((x) => x.id === model.card.tier);

  function control_(field) {
    if (field.kind === "toggle") {
      const c = featureToggles({ field, features: catalogue.features.filter((f) => f.offered !== false), effective: features(), tier: tierEntry(), onToggle: (key, on) => { commit({ features: { [key]: on } }); drawStep(); } });
      return c;
    }
    if (field.kind === "image") {
      const box = imageBox({ label: field.label, kind: field.asset, hint: media.rule(field.asset)?.hint, asset: model.assets.find((a) => a.kind === field.asset), media, required: field.required });
      return box;
    }
    if (field.kind === "images" && field.path === "portraits") {
      const slotBox = (slot, label) => imageBox({ label, kind: "portrait", slot, asset: model.assets.find((a) => a.path.startsWith(`portrait/${slot}.`)), media });
      const node = h("div", { class: "field cd-portraits" }, h("span", { class: "lab" }, t(field.label)), h("span", { class: "muted cd-hint" }, t(media.rule("portrait")?.hint || "")), h("div", { class: "cd-two" }, slotBox("groom", "Pengantin lelaki").node, slotBox("bride", "Pengantin perempuan").node));
      return { node, setError() {} };
    }
    if (field.kind === "images") return galleryField({ field, draft: () => model.draft, media, commit });
    if (field.path === "gifts.items") return giftsField({ field, draft: () => model.draft, media, commit });
    const value = readValue(model.draft, field);
    if (field.kind === "theme") {
      const picker = themePicker({ themes: catalogue.themes, value: model.draft.theme, onPick: (theme) => { commit({ theme, palette: null }); paintPalette(); } });
      return { node: picker.node };
    }
    if (field.kind === "palette") { const c = renderField(field, { value, onInput: (v) => commit({ palette: v === "classic" ? null : v }), theme: themeEntry() }); paletteControl = c; return c; }
    if (field.kind === "model") return renderField(field, { value, onInput: (v) => commit({ couple: { model: { [field.path.endsWith("groom") ? "groom" : "bride"]: v || null } } }), models: catalogue.models, culture: themeEntry()?.culture });
    if (field.kind === "song") {
      return renderField(field, { value, onInput: () => {}, song: {
        current: () => model.assets.find((a) => a.kind === "music"),
        upload: async (file) => { await saver.flush(); await api.uploadCardAsset(id, "music", file); await reload(); },
        remove: async (asset) => { await saver.flush(); await api.deleteCardAsset(id, asset.id); await reload(); },
        message: cardErrorMessage
      } });
    }
    return renderField(field, { value, onInput: changeField(field) });
  }
  let paletteControl = null;
  const paintPalette = () => paletteControl?.redraw?.(model.draft.palette, themeEntry());

  // ----- the last step: what is left, and the card's address
  function drawSummary() {
    const status = model.status;
    const group = (list, textOf) => {
      const by = new Map();
      for (const item of list) { const k = item.step ?? "terbit"; if (!by.has(k)) by.set(k, []); by.get(k).push(item); }
      return [...by].map(([k, items]) => h("div", { class: "todo" }, h("strong", {}, t(steps.find((s) => s.id === k)?.title || "")), h("ul", {}, ...items.map((m) => h("li", {}, textOf(m)))), h("button", { type: "button", class: "linkbtn", onclick: () => goStep(k) }, t("Pergi ke langkah ini"))));
    };
    const problems = (status?.problems ?? []).map((p) => ({ ...p, step: undefined }));
    const slugBox = slugEditor();
    form.replaceChildren(...[
      h("h1", { class: "stephead" }, t("Semak & terbit")),
      status?.ready ? h("div", { class: "hh-banner info", role: "status" }, icon("check"), h("span", { class: "msg" }, h("strong", {}, t("Semua maklumat wajib sudah lengkap")))) : null,
      !status?.ready ? h("section", {}, h("h2", { class: "sec" }, t("Yang belum lengkap")), ...group(status?.missing ?? [], (m) => t(m.label))) : null,
      problems.length ? h("section", {}, h("h2", { class: "sec" }, t("Perlu dibetulkan")), h("ul", { class: "problems" }, ...problems.map((p) => h("li", {}, h("strong", {}, p.field), ": ", p.message)))) : null,
      h("section", {}, h("h2", { class: "sec" }, t("Alamat kad")), slugBox),
      h("section", {}, h("h2", { class: "sec" }, t("Pakej")), h("p", {}, h("strong", {}, catalogue.tiers.find((x) => x.id === model.card.tier)?.label || ""), " ", culturePill(themeEntry()?.culture || "modern")), h("p", { class: "muted" }, t("Harga akan dimaklumkan kemudian."))),
      h("section", {}, h("h2", { class: "sec" }, t("Pratonton kad anda")), previewPanel()),
      h("section", { class: "publish" }, h("h2", { class: "sec" }, t("Terbitkan")), publishPanel())
    ].filter(Boolean));
  }

  // ----- the preview of the customer's own card: built by the build server, usually in a few seconds; required before buying
  let previewTimer = null, publishTimer = null, repaintPublish = null;
  const stopPolling = () => { clearTimeout(previewTimer); previewTimer = null; clearTimeout(publishTimer); publishTimer = null; repaintPublish = null; };
  function previewPanel() {
    stopPolling();
    const box = h("div", { class: "cd-pv" });
    let pv = model.preview ?? null, busy = false, err = "";
    const paint = () => {
      const state = previewPanelState(pv);
      const build = (label) => h("button", { type: "button", class: "btn primary", disabled: busy || !model.status?.ready, onclick: start }, label);
      const url = pv?.url ? new URL(pv.url, location.origin).href : "";
      const kids = [];
      if (!model.status?.ready) kids.push(h("p", { class: "muted" }, t("Lengkapkan semua maklumat wajib dahulu, kemudian bina pratonton.")));
      if (state === "none") kids.push(h("p", { class: "muted" }, t("Lihat kad anda sendiri, dengan nama, gambar dan pilihan anda, sebelum membeli.")), build(t("Bina pratonton")));
      if (state === "working") kids.push(h("p", { role: "status", class: "cd-working" }, t("Sedang membina pratonton… biasanya mengambil masa kurang seminit.")));
      if (state === "failed") kids.push(h("p", { class: "err", role: "alert" }, t("Pratonton tidak dapat dibina. Cuba lagi.")), build(t("Cuba lagi")));
      if (state === "outdated") kids.push(h("div", { class: "hh-banner warn", role: "status" }, h("span", { class: "msg" }, t("Kad ini diubah selepas pratonton ini dibina. Bina semula sebelum membeli."))), build(t("Bina pratonton baharu")));
      if (state === "ready") kids.push(h("p", { class: "cd-ok" }, icon("check"), t("Pratonton kad anda sudah sedia")));
      if ((state === "ready" || state === "outdated" || (state === "working" && url)) && url) {
        kids.push(
          h("div", { class: "cd-pv-frame" }, h("iframe", { src: url, title: t("Pratonton kad anda"), loading: "lazy", referrerpolicy: "no-referrer" })),
          h("p", { class: "muted cd-small" }, expiryText(pv.expiresAt)),
          h("div", { class: "cd-pv-acts" },
            h("a", { class: "btn light slim", href: url, target: "_blank", rel: "noopener noreferrer" }, t("Buka pratonton")),
            h("button", { type: "button", class: "btn light slim", onclick: async () => { try { await navigator.clipboard.writeText(url); toast(t("Pautan disalin")); } catch { toast(url); } } }, t("Salin pautan"))),
          h("p", { class: "muted cd-small" }, t("Pautan ini hanya untuk anda dan keluarga. Ia tidak muncul di Google.")));
        if (state === "ready") kids.push(h("button", { type: "button", class: "linkbtn", disabled: busy, onclick: start }, t("Bina semula")));
      }
      if (err) kids.push(h("p", { class: "err", role: "alert" }, err));
      box.replaceChildren(...kids);
      repaintPublish?.();
    };
    const poll = async () => {
      if (!view.isConnected) return;
      try { pv = model.preview = await api.getCardPreview(id); err = ""; } catch (e) { if (isSignedOut(e)) return ctx.signIn(); }
      paint();
      if (previewWorking(pv)) previewTimer = setTimeout(poll, 2500);
    };
    async function start() {
      busy = true; err = ""; paint();
      try {
        const state = await saver.flush();                       // the preview is of what the server has: save what is waiting first
        if (["error", "retrying", "conflict"].includes(state)) throw Object.assign(new Error("not saved"), { code: "not_saved" });
        pv = model.preview = await api.startCardPreview(id);
      } catch (e) { err = e?.code === "not_saved" ? t("Perubahan anda belum disimpan. Semak sambungan, kemudian cuba lagi.") : cardErrorMessage(e); }
      busy = false; paint();
      if (previewWorking(pv)) previewTimer = setTimeout(poll, 2500);
    }
    paint();
    void poll();
    return box;
  }

  // ----- publishing: the real card, at its own address. Needs the package to be activated, a complete card and a preview of the card as it is now.
  function publishPanel() {
    const box = h("div", { class: "cd-pub" });
    let pub = model.publish ?? null, busy = false, err = "", confirmDown = false;
    const REASONS = {
      payment: t("Pakej anda belum diaktifkan. Hubungi kami untuk mengaktifkannya, kemudian anda boleh menerbitkan."),
      incomplete: t("Lengkapkan semua maklumat wajib dahulu."),
      preview: t("Bina dan lihat pratonton terkini kad anda dahulu. Anda hanya boleh menerbitkan selepas itu.")
    };
    const paint = () => {
      const state = publishPanelState(pub);
      const gate = publishGate({ card: model.card, status: model.status, preview: model.preview });
      const kids = [];
      if (state === "working") kids.push(h("p", { role: "status", class: "cd-working" }, t("Sedang menerbitkan kad anda…")));
      else {
        if (state === "live" || state === "changed") {
          kids.push(h("p", { class: "cd-ok" }, icon("check"), t("Kad anda sudah diterbitkan")));
          kids.push(h("p", {}, h("a", { href: pub.url, target: "_blank", rel: "noopener noreferrer" }, pub.url.replace(/^https?:\/\//, ""))));
          kids.push(h("div", { class: "cd-pv-acts" },
            h("a", { class: "btn light slim", href: pub.url, target: "_blank", rel: "noopener noreferrer" }, t("Buka kad")),
            h("button", { type: "button", class: "btn light slim", onclick: async () => { try { await navigator.clipboard.writeText(pub.url); toast(t("Pautan disalin")); } catch { toast(pub.url); } } }, t("Salin pautan")),
            h("a", { class: "btn light slim", href: `https://wa.me/?text=${encodeURIComponent(pub.url)}`, target: "_blank", rel: "noopener noreferrer" }, t("Kongsi di WhatsApp"))));
        }
        if (state === "live" || state === "changed") kids.push(confirmDown
          ? h("div", { class: "cd-down", role: "group" },
              h("p", { class: "cd-small" }, t("Kad akan hilang serta-merta daripada pautan ini dan tetamu tidak dapat melihatnya. Anda boleh menerbitkannya semula bila-bila masa.")),
              h("div", { class: "cd-pv-acts" },
                h("button", { type: "button", class: "btn danger slim", disabled: busy, onclick: takeDown }, t("Ya, tarik balik")),
                h("button", { type: "button", class: "btn light slim", disabled: busy, onclick: () => { confirmDown = false; paint(); } }, t("Batal"))))
          : h("button", { type: "button", class: "linkbtn", onclick: () => { confirmDown = true; paint(); } }, t("Tarik balik kad ini")));
        if (state === "changed") kids.push(h("div", { class: "hh-banner warn", role: "status" }, h("span", { class: "msg" }, t("Anda mengubah kad selepas ia diterbitkan. Kad yang dilihat tetamu masih yang lama sehingga anda menerbitkannya semula."))));
        if (state === "failed") kids.push(h("p", { class: "err", role: "alert" }, pub.error === "changed" ? t("Kad diubah selepas anda menekan Terbitkan. Lihat pratonton sekali lagi, kemudian terbitkan.") : t("Kad tidak dapat diterbitkan. Cuba lagi.")));
        const label = state === "live" ? t("Terbitkan semula") : state === "changed" ? t("Terbitkan semula") : t("Terbitkan kad");
        if (state !== "live") kids.push(h("button", { type: "button", class: "btn primary", disabled: busy || !gate.ok, onclick: start }, label));
        if (!gate.ok && state !== "live") kids.push(h("p", { class: "muted cd-small" }, REASONS[gate.reason]));
        if (gate.ok && state !== "live") kids.push(h("p", { class: "muted cd-small" }, t("Kad yang diterbitkan akan dapat dilihat oleh sesiapa yang ada pautannya.")));
      }
      if (err) kids.push(h("p", { class: "err", role: "alert" }, err));
      box.replaceChildren(...kids);
    };
    const poll = async () => {
      if (!view.isConnected) return;
      const wasWorking = publishPanelState(pub) === "working";
      try { pub = model.publish = await api.getCardPublish(id); err = ""; } catch (e) { if (isSignedOut(e)) return ctx.signIn(); }
      if (wasWorking && publishPanelState(pub) !== "working") { await reload(); return; }          // it just finished: the card's own status (live) changed, so draw the step again from the server
      paint();
      if (publishPanelState(pub) === "working") publishTimer = setTimeout(poll, 2500);
    };
    async function takeDown() {
      busy = true; err = ""; paint();
      try { await api.unpublishCard(id); toast(t("Kad ditarik balik")); await reload(); return; }
      catch (e) { err = cardErrorMessage(e); }
      busy = false; confirmDown = false; paint();
    }
    async function start() {
      busy = true; err = ""; paint();
      try {
        const state = await saver.flush();
        if (["error", "retrying", "conflict"].includes(state)) throw Object.assign(new Error("not saved"), { code: "not_saved" });
        pub = model.publish = await api.publishCard(id);
      } catch (e) {
        err = e?.code === "not_saved" ? t("Perubahan anda belum disimpan. Semak sambungan, kemudian cuba lagi.") : cardErrorMessage(e);
      }
      busy = false; paint();
      if (publishPanelState(pub) === "working") publishTimer = setTimeout(poll, 2500);
    }
    repaintPublish = paint;
    paint();
    void poll();
    return box;
  }

  function slugEditor() {
    if (model.card.status === "live") return h("div", { class: "slug" }, h("p", {}, h("strong", {}, model.card.slug)), h("p", { class: "muted cd-small" }, t("Alamat kad tidak boleh diubah selepas diterbitkan.")));
    const origin = location.origin;
    const input = h("input", { type: "text", value: model.card.slug, maxlength: 40, autocapitalize: "none", spellcheck: "false", "aria-label": t("Alamat kad") });
    const result = h("span", { class: "muted cd-small", role: "status" });
    const save = h("button", { type: "button", class: "btn light slim", disabled: true }, t("Simpan alamat"));
    const suggest = h("button", { type: "button", class: "linkbtn", onclick: () => { const g = model.draft.couple?.groom?.short || model.draft.couple?.groom?.name, b = model.draft.couple?.bride?.short || model.draft.couple?.bride?.name; const [x, y] = model.draft.couple?.first === "bride" ? [b, g] : [g, b]; input.value = suggestSlug(x || "", y || ""); input.dispatchEvent(new Event("input")); } }, t("Cadangkan daripada nama"));
    let timer = null, ok = false;
    input.addEventListener("input", () => {
      clearTimeout(timer); ok = false; save.disabled = true; result.className = "muted cd-small"; result.textContent = "";
      const value = input.value.trim().toLowerCase();
      if (value === model.card.slug) return;
      timer = setTimeout(async () => {
        try { const r = await api.checkCardSlug(id, value); ok = r.ok; result.className = r.ok ? "cd-ok cd-small" : "err cd-small"; result.textContent = r.ok ? t("Alamat ini boleh digunakan.") : r.problem; save.disabled = !r.ok; } catch (e) { result.textContent = cardErrorMessage(e); }
      }, 400);
    });
    save.addEventListener("click", async () => {
      save.disabled = true;
      try { const r = await api.setCardSlug(id, input.value.trim().toLowerCase()); model.card = r.card; model.status = r.status; model.version = r.card.version; toast(t("Alamat disimpan")); paintChrome(); drawStep(); } catch (e) { result.className = "err cd-small"; result.textContent = cardErrorMessage(e); save.disabled = !ok; }
    });
    return h("div", { class: "slug" }, h("div", { class: "slug-row" }, h("span", { class: "muted" }, `${origin.replace(/^https?:\/\//, "")}/`), input), result, h("div", { class: "slug-acts" }, suggest, save));
  }

  // ----- assemble
  const back = async () => { await saver.flush(); go("/app/cards"); };
  view.append(h("div", { class: "cd-page" },
    h("header", { class: "bar" }, h("button", { class: "iconbtn", "aria-label": t("Kembali"), onclick: back }, icon("back")), h("h1", {}, title), pill),
    tabs,
    h("div", { class: "cd-body" }, form, h("aside", { class: "cd-aside", "aria-label": t("Contoh kad") }, preview.node)),
    h("footer", { class: "cd-foot" }, progress, h("span", { class: "navs" }, prev, next)), showPreview));
  show(wrapPage(ctx, view));
  paintChrome(); drawStep(); preview.update(previewState());
  return view;
}

/** The account page's frame (brand bar) around the editor, kept wide. */
function wrapPage(ctx, view) {
  const frame = ctx.page(view);
  return ctx.wide(frame);
}
