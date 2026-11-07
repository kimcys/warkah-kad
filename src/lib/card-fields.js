// The controls of the invitation builder's form: one function per kind of field in the kit's BUILDER_STEPS.
// Each returns { node, setError(message) }. `value` is what readValue (card-form.js) gives; `onInput(newValue)` is called on every change,
// and the screen turns it into a patch and saves it. The words are Malay (t(): the Malay text is the key).
import { h, icon } from "./dom.js";
import { t } from "./i18n.js";
import { listShape } from "./card-form.js";
import { todayMyt } from "./session.js";

const LIMITS = { "couple.groom.name": 60, "couple.bride.name": 60, "couple.groom.full": 80, "couple.bride.full": 80, "couple.groom.short": 30, "couple.bride.short": 30, "couple.hashtag": 40, "venue.name": 80, "venue.area": 80, "music.title": 80, "music.artist": 80 };
const PLACEHOLDERS = {
  "couple.groom.name": "Muhammad Hafiz", "couple.groom.full": "bin Hj. Rahman", "couple.groom.short": "Hafiz",
  "couple.bride.name": "Nur Aisyah", "couple.bride.full": "binti Hj. Kamal", "couple.bride.short": "Aisyah",
  "couple.hashtag": "#AisyahHafiz2027", "venue.name": "Dewan Seri Kenanga", "venue.area": "Shah Alam, Selangor",
  "venue.maps": "https://maps.app.goo.gl/…", "venue.waze": "https://waze.com/ul/…",
  "ayat.ref": "Surah Ar-Rum (30:21)", "duitnow.accountName": "Nama seperti dalam akaun bank", "dressCode.note": "Contoh: Sila elakkan warna putih"
};
const URL_HELP = {
  "ayat.ref": "Biarkan rujukan, ayat dan terjemahan kosong untuk Ar-Rum 30:21.",
  "venue.maps": "Buka tempat itu di Google Maps, tekan Kongsi, kemudian salin pautan.",
  "venue.waze": "Buka tempat itu di Waze, tekan Kongsi, kemudian salin pautan."
};

const requiredMark = (field) => (field.required ? h("span", { class: "req", "aria-hidden": "true" }, " *") : null);

/** A label, a control, a hint and a place for an error: the frame every simple field shares. */
function frame(field, control, { hint, flat = false } = {}) {
  const err = h("span", { class: "err", role: "alert" });
  const node = h("label", { class: flat ? "field flat" : "field" }, h("span", { class: "lab" }, t(field.label), requiredMark(field)), control, hint ? h("span", { class: "muted cd-hint" }, t(hint)) : null, err);
  return { node, setError: (m) => { err.textContent = m || ""; node.classList.toggle("bad", !!m); } };
}

const bind = (el, onInput, read = (e) => e.target.value) => (el.addEventListener("input", (e) => onInput(read(e))), el);

function text(field, { value, onInput }) {
  const kind = field.kind === "url" ? "url" : "text";
  const control = bind(h("input", { type: kind, value, maxlength: LIMITS[field.path] ?? 120, placeholder: PLACEHOLDERS[field.path] || "", autocomplete: "off", ...(kind === "url" ? { inputmode: "url", autocapitalize: "none", spellcheck: "false" } : {}) }), onInput);
  return frame(field, control, { hint: field.help || URL_HELP[field.path] });
}

function longtext(field, { value, onInput }) {
  const arabic = field.path === "ayat.arabic";
  return frame(field, bind(h("textarea", { rows: 3, maxlength: 400, ...(arabic ? { dir: "rtl", lang: "ar", placeholder: "…وَمِنْ آيَاتِهِ" } : {}) }, value), onInput), { hint: field.help });
}

function lines(field, { value, onInput }) {
  const rows = field.path === "host.parents" ? 2 : 3;
  return frame(field, bind(h("textarea", { rows, maxlength: 400, autocapitalize: "words" }, value), onInput), { hint: field.help });
}

function number(field, { value, onInput }) {
  return frame(field, bind(h("input", { type: "number", min: 1, max: 10, inputmode: "numeric", value: value === "" ? "" : String(value) }), onInput), { hint: field.help });
}

function select(field, { value, onInput }) {
  const control = h("select", {}, ...(field.options || []).map((o) => h("option", { value: o.value, selected: o.value === (value || field.options[0].value) }, t(o.label))));
  control.addEventListener("change", (e) => onInput(e.target.value));
  return frame(field, control, { hint: field.help });
}

function datetime(field, { value, onInput }) {
  const state = { date: value.date, time: value.time };
  const date = h("input", { type: "date", value: state.date, min: field.path === "date.start" ? todayMyt() : undefined });
  const time = h("input", { type: "time", value: state.time, step: 300 });
  const push = () => onInput({ ...state });
  date.addEventListener("input", () => { state.date = date.value; push(); });
  time.addEventListener("input", () => { state.time = time.value; push(); });
  const err = h("span", { class: "err", role: "alert" });
  const node = h("div", { class: "field cd-dt" }, h("span", { class: "lab" }, t(field.label), requiredMark(field)), h("div", { class: "cd-dt-row" }, date, time), err);
  return { node, setError: (m) => { err.textContent = m || ""; node.classList.toggle("bad", !!m); }, set: (v) => { date.value = v.date; time.value = v.time; Object.assign(state, v); } };
}

/** The rows of a list (the programme, the people to contact): add, remove, move up and down. */
function list(field, { value, onInput }) {
  const shape = listShape(field.path);
  const rows = value.length ? value.map((r) => ({ ...r })) : [];
  const body = h("div", { class: "cd-rows" });
  const err = h("span", { class: "err", role: "alert" });
  const add = h("button", { type: "button", class: "btn light slim" }, icon("plus"), shape.addLabel);
  const changed = () => { onInput(rows.map((r) => ({ ...r }))); add.disabled = rows.length >= shape.max; };
  const draw = () => {
    body.replaceChildren(...rows.map((row, i) => {
      const cells = shape.columns.map((col) => {
        const input = col.kind === "select"
          ? h("select", { "aria-label": col.label }, ...col.options.map((o) => h("option", { value: o.value, selected: o.value === (row[col.key] || col.options[0].value) }, o.label)))
          : h("input", { type: col.kind === "tel" ? "tel" : "text", value: row[col.key] ?? "", maxlength: col.max, placeholder: col.placeholder || "", "aria-label": col.label, inputmode: col.kind === "tel" ? "tel" : undefined });
        input.addEventListener(col.kind === "select" ? "change" : "input", () => { row[col.key] = input.value; changed(); });
        return h("label", { class: `cell ${col.key}` }, h("span", { class: "muted" }, col.label), input);
      });
      const move = (to) => { const [r] = rows.splice(i, 1); rows.splice(to, 0, r); draw(); changed(); };
      return h("div", { class: "row-card" }, h("div", { class: "cells" }, ...cells),
        h("div", { class: "row-acts" },
          h("button", { type: "button", class: "iconbtn cd-small", "aria-label": t("Naik"), disabled: i === 0, onclick: () => move(i - 1) }, "↑"),
          h("button", { type: "button", class: "iconbtn cd-small", "aria-label": t("Turun"), disabled: i === rows.length - 1, onclick: () => move(i + 1) }, "↓"),
          h("button", { type: "button", class: "linkbtn bad", onclick: () => { rows.splice(i, 1); draw(); changed(); } }, t("Padam"))));
    }));
    add.disabled = rows.length >= shape.max;
  };
  add.addEventListener("click", () => { rows.push({ ...shape.blank }); draw(); changed(); body.lastElementChild?.querySelector("input")?.focus(); });
  draw();
  const node = h("div", { class: "field list" }, h("span", { class: "lab" }, t(field.label), requiredMark(field)), field.help ? h("span", { class: "muted cd-hint" }, t(field.help)) : null, body, add, err);
  return { node, setError: (m) => { err.textContent = m || ""; node.classList.toggle("bad", !!m); } };
}

/* ---------- pickers (they read the catalogue the kit publishes) ---------- */

const CULTURE = { malay: "Melayu", modern: "Moden" };
export const culturePill = (culture) => h("span", { class: `cd-pill ${culture}` }, t(CULTURE[culture] || culture));

/** The themes as cards with their photographs. `onPick(themeKey)`. */
export function themePicker({ themes, value, onPick, lang = "ms" }) {
  const node = h("div", { class: "cd-themes", role: "radiogroup", "aria-label": t("Tema") });
  const draw = (current) => node.replaceChildren(...themes.map((th) => h("button", { type: "button", class: `cd-theme${th.key === current ? " on" : ""}`, role: "radio", "aria-checked": String(th.key === current), onclick: () => { draw(th.key); onPick(th.key); } },
    h("span", { class: "shots" },
      th.thumbnails?.classic?.home ? h("img", { src: `/builder/${th.thumbnails.classic.home.replace(/^samples\//, "")}`, alt: "", loading: "lazy", decoding: "async" }) : null,
      th.thumbnails?.opening ? h("img", { src: `/builder/${th.thumbnails.opening.replace(/^samples\//, "")}`, alt: "", loading: "lazy", decoding: "async" }) : null),
    h("span", { class: "cd-meta" }, h("strong", {}, th.label[lang] || th.label.ms), culturePill(th.culture), h("span", { class: "muted" }, th.description[lang] || th.description.ms)),
    th.key === current ? h("span", { class: "tick" }, icon("check")) : null)));
  draw(value);
  return { node, set: draw };
}

function paletteField(field, { value, onInput, theme }) {
  const node = h("div", { class: "field" });
  const chips = h("div", { class: "cd-palettes", role: "radiogroup", "aria-label": t(field.label) });
  const draw = (current, themeEntry) => {
    const options = themeEntry ? [{ id: "classic", label: themeEntry.classic.label, swatch: themeEntry.classic.swatch }, ...themeEntry.palettes] : [];
    chips.replaceChildren(...options.map((p) => h("button", { type: "button", class: `cd-chip${(current || "classic") === p.id ? " on" : ""}`, role: "radio", "aria-checked": String((current || "classic") === p.id), onclick: () => { draw(p.id, themeEntry); onInput(p.id); } },
      h("span", { class: "cd-swatch" }, ...p.swatch.map((c) => h("i", { style: `background:${c}` }))), h("span", {}, p.label.ms))));
    if (!themeEntry) chips.replaceChildren(h("span", { class: "muted" }, t("Pilih tema dahulu.")));
  };
  draw(value, theme);
  node.append(h("span", { class: "lab" }, t(field.label)), chips);
  return { node, setError() {}, redraw: (current, themeEntry) => draw(current, themeEntry) };
}

/** Groom or bride: the figures of the library as tiles; the ones that suit the theme's culture come first. */
function modelField(field, { value, onInput, models, culture }) {
  const who = field.path.endsWith("groom") ? "groom" : "bride";
  const node = h("div", { class: "field" });
  const grid = h("div", { class: "cd-models", role: "radiogroup", "aria-label": t(field.label) });
  const list = models.filter((m) => m.who === who).sort((a, b) => Number(b.culture === culture) - Number(a.culture === culture));
  const draw = (current) => grid.replaceChildren(
    h("button", { type: "button", class: `cd-model auto${!current ? " on" : ""}`, role: "radio", "aria-checked": String(!current), onclick: () => { draw(""); onInput(""); } }, h("span", { class: "auto-text" }, t("Ikut tema")), h("small", { class: "muted" }, t("Model yang dipilih untuk tema"))),
    ...list.map((m) => h("button", { type: "button", class: `cd-model${m.id === current ? " on" : ""}`, role: "radio", "aria-checked": String(m.id === current), onclick: () => { draw(m.id); onInput(m.id); } },
      h("img", { src: `/builder/models/${m.file}`, alt: "", loading: "lazy", decoding: "async" }),
      h("span", { class: "mname" }, m.label), h("span", { class: "mtags" }, culturePill(m.culture), m.culture === culture ? h("em", {}, t("Sesuai dengan tema")) : null))));
  draw(value);
  node.append(h("span", { class: "lab" }, t(field.label)), grid);
  return { node, setError() {} };
}

/** The song: choose a file (MP3 or M4A, up to 6 MB); it is stored with the card. */
function songField(field, { value, onInput, song }) {
  void onInput; void value;
  const err = h("span", { class: "err", role: "alert" });
  const status = h("div", { class: "song-state" });
  const input = h("input", { type: "file", accept: "audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a", class: "cd-hidden", onchange: async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { err.textContent = t("Fail terlalu besar (maksimum 6 MB)."); return; }
    err.textContent = ""; pick.disabled = true; pick.textContent = t("Memuat naik…");
    try { await song.upload(file); } catch (e) { err.textContent = song.message(e); }
    pick.disabled = false; draw();
  } });
  const pick = h("button", { type: "button", class: "btn light slim", onclick: () => input.click() }, "");
  const draw = () => {
    const have = song.current();
    status.replaceChildren(...[have ? h("span", { class: "cd-ok" }, icon("check"), t("Lagu telah dimuat naik ({kb} KB)", { kb: Math.round(have.bytes / 1024) })) : h("span", { class: "muted" }, t("Belum ada lagu. MP3 atau M4A, kurang 6 MB.")),
      have ? h("button", { type: "button", class: "linkbtn bad", onclick: async () => { err.textContent = ""; try { await song.remove(have); } catch (e) { err.textContent = song.message(e); } draw(); } }, t("Buang")) : null].filter(Boolean));
    pick.textContent = have ? t("Tukar lagu") : t("Pilih lagu");
  };
  draw();
  const node = h("div", { class: "field" }, h("span", { class: "lab" }, t(field.label)), status, pick, input, err);
  return { node, setError: (m) => { err.textContent = m || ""; }, redraw: draw };
}

const RENDERERS = { text, url: text, longtext, lines, number, select, datetime, list, palette: paletteField, model: modelField, song: songField };

/** The control for a field, or null for kinds the screen draws itself (theme, toggles, images). */
export function renderField(field, args) {
  const make = RENDERERS[field.kind];
  return make ? make(field, args) : null;
}
