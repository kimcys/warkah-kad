// The builder's picture and switch controls (steps Gambar and Tambahan). Like card-fields.js, each returns { node, setError }.
// The screen passes `media`, which does the work that touches the server, so these stay about what is drawn:
//   media.rule(kind)                the kit's upload rule      media.asset(path)  the stored file at a path, or undefined
//   media.url(asset)                where to show it           media.upload(kind, file, { slot, square })  prepares, uploads, reloads
//   media.remove(asset)             deletes it and reloads     media.message(error)  words for a failure
import { h, icon } from "./dom.js";
import { t } from "./i18n.js";
import { blankGift, featureRows, isBlankGift, moveItem } from "./card-form.js";

const kb = (n) => Math.round(n / 1024);

/** One picture: a thumbnail (or an empty frame), a button to pick or replace it, a button to remove it. */
export function imageBox({ label, hint, kind, slot, square = false, asset, media, small = false, required = false }) {
  const err = h("span", { class: "err", role: "alert" });
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/heic,image/heif", class: "cd-hidden" });
  const pick = h("button", { type: "button", class: "btn light slim", onclick: () => input.click() }, asset ? t("Tukar gambar") : t("Pilih gambar"));
  const busy = (on) => { pick.disabled = on; input.disabled = on; if (on) pick.textContent = t("Memuat naik…"); };
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    err.textContent = ""; busy(true);
    try { await media.upload(kind, file, { slot, square }); }
    catch (e) { err.textContent = media.message(e); busy(false); pick.textContent = asset ? t("Tukar gambar") : t("Pilih gambar"); }
  });
  const thumb = asset
    ? h("img", { class: "cd-thumb", src: media.url(asset), alt: "", width: asset.width || undefined, height: asset.height || undefined })
    : h("span", { class: "cd-thumb empty" }, t("Belum ada gambar"));
  const remove = asset ? h("button", { type: "button", class: "linkbtn bad", onclick: async () => { err.textContent = ""; try { await media.remove(asset); } catch (e) { err.textContent = media.message(e); } } }, t("Buang")) : null;
  const node = h("div", { class: `field cd-image${small ? " small" : ""}${square ? " square" : ""}` },
    h("span", { class: "lab" }, t(label), required ? h("span", { class: "req", "aria-hidden": "true" }, " *") : null),
    h("div", { class: "cd-image-row" }, thumb,
      h("div", { class: "cd-image-side" },
        asset ? h("span", { class: "cd-ok" }, icon("check"), t("{kb} KB", { kb: kb(asset.bytes) })) : null,
        hint ? h("span", { class: "muted cd-hint" }, t(hint)) : null,
        h("div", { class: "cd-image-acts" }, pick, remove))),
    input, err);
  return { node, setError: (m) => { if (m) err.textContent = m; node.classList.toggle("bad", !!m); } };
}

/** The gallery pictures in the card's order: move, describe, remove, and add more (several at once). */
export function galleryField({ field, draft, media, commit }) {
  const rule = media.rule("gallery");
  const max = rule?.max ?? 12;
  const err = h("span", { class: "err", role: "alert" });
  const items = () => (Array.isArray(draft().gallery) ? draft().gallery : []);
  const body = h("div", { class: "cd-gallery" });
  const input = h("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp,image/heic,image/heif", class: "cd-hidden" });
  const add = h("button", { type: "button", class: "btn light slim", onclick: () => input.click() }, icon("plus"), t("Tambah gambar"));
  const status = h("span", { class: "muted cd-hint" });
  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length) return;
    const room = max - items().length;
    err.textContent = files.length > room ? t("Hanya {n} gambar lagi boleh ditambah.", { n: Math.max(room, 0) }) : "";
    add.disabled = true;
    const problems = [];
    let done = 0;
    for (const file of files.slice(0, Math.max(room, 0))) {
      status.textContent = t("Memuat naik {i} daripada {n}…", { i: ++done, n: Math.min(files.length, room) });
      try { await media.upload("gallery", file, { reload: false }); } catch (e) { problems.push(`${file.name}: ${media.message(e)}`); }
    }
    status.textContent = "";
    await media.refresh();
    if (problems.length) err.textContent = problems.join(" ");
  });
  const draw = () => {
    const list = items();
    body.replaceChildren(...list.map((g, i) => {
      const asset = media.asset(g.src);
      const alt = h("input", { type: "text", value: g.alt ?? "", maxlength: 120, placeholder: t("Keterangan gambar (pilihan)"), "aria-label": t("Keterangan gambar") });
      alt.addEventListener("input", () => commit({ gallery: items().map((x, j) => (j === i ? { ...x, alt: alt.value } : x)) }));
      return h("div", { class: "cd-tile" },
        asset ? h("img", { class: "cd-thumb", src: media.url(asset), alt: "" }) : h("span", { class: "cd-thumb empty" }, "?"),
        h("div", { class: "cd-tile-side" }, alt,
          h("div", { class: "row-acts" },
            h("button", { type: "button", class: "iconbtn cd-small", "aria-label": t("Naik"), disabled: i === 0, onclick: () => { commit({ gallery: moveItem(items(), i, i - 1) }); draw(); } }, "↑"),
            h("button", { type: "button", class: "iconbtn cd-small", "aria-label": t("Turun"), disabled: i === list.length - 1, onclick: () => { commit({ gallery: moveItem(items(), i, i + 1) }); draw(); } }, "↓"),
            h("button", { type: "button", class: "linkbtn bad", disabled: !asset, onclick: async () => { err.textContent = ""; try { await media.remove(asset); } catch (e) { err.textContent = media.message(e); } } }, t("Buang")))));
    }));
    add.disabled = list.length >= max;
  };
  draw();
  const node = h("div", { class: "field list" },
    h("span", { class: "lab" }, t(field.label), h("span", { class: "muted" }, ` (${items().length}/${max})`)),
    h("span", { class: "muted cd-hint" }, t(rule?.hint || "")), body, add, status, input, err);
  return { node, setError: (m) => { err.textContent = m || ""; node.classList.toggle("bad", !!m); } };
}

/** The switches: what the card has. Pages first, then extras; ones outside the package are locked. */
export function featureToggles({ field, features, effective, tier, onToggle }) {
  const rows = featureRows(features, effective, tier);
  const list = h("div", { class: "cd-switches" });
  const draw = (eff) => list.replaceChildren(...featureRows(features, eff, tier).map((r) => {
    const box = h("input", { type: "checkbox", checked: r.on, disabled: r.locked, role: "switch", "aria-label": t(r.label) });
    box.addEventListener("change", () => onToggle(r.key, box.checked));
    return h("label", { class: `cd-switch${r.locked ? " locked" : ""}` }, box,
      h("span", { class: "cd-switch-text" }, h("strong", {}, t(r.label)), h("span", { class: "muted" }, t(r.description)), r.locked ? h("em", {}, t("Tidak termasuk dalam pakej anda")) : null));
  }));
  void rows;
  draw(effective);
  const node = h("div", { class: "field" }, h("span", { class: "lab" }, t(field.label)), field.help ? h("span", { class: "muted cd-hint" }, t(field.help)) : null, list);
  return { node, setError() {}, redraw: draw };
}

/** The gift list: name, price, shop link, note and a photo for each. Rows are saved once they have something in them (or a photo). */
export function giftsField({ field, draft, media, commit }) {
  const max = 20;
  const err = h("span", { class: "err", role: "alert" });
  const stored = draft().gifts?.items;
  const rows = (Array.isArray(stored) ? stored : []).map((r) => ({ ...r }));
  const body = h("div", { class: "cd-rows" });
  const add = h("button", { type: "button", class: "btn light slim", onclick: () => { rows.push(blankGift(media.nextGiftId(rows))); draw(); changed(false); body.lastElementChild?.querySelector("input[type=text]")?.focus(); } }, icon("plus"), t("Tambah hadiah"));
  const keep = (r) => !isBlankGift(r) || !!media.asset(`gifts/${r.id}.webp`);
  const changed = (save = true) => { if (save) commit({ gifts: { items: rows.filter(keep).map((r) => ({ ...r })) } }); add.disabled = rows.length >= max; };
  const cell = (row, key, label, extra = {}) => {
    const input = h("input", { type: "text", value: row[key] ?? "", "aria-label": label, ...extra });
    input.addEventListener("input", () => { row[key] = input.value; changed(); });
    return h("label", { class: `cell ${key}` }, h("span", { class: "muted" }, label), input);
  };
  const draw = () => {
    body.replaceChildren(...rows.map((row, i) => {
      const asset = media.asset(`gifts/${row.id}.webp`);
      const photo = imageBox({ label: "Gambar", hint: "Wajib. Dipotong persegi.", required: true, kind: "gift", slot: row.id, square: true, asset, media: { ...media, upload: async (kind, file, o) => { await media.upload(kind, file, { ...o, before: () => commit({ gifts: { items: rows.filter((r) => keep(r) || r.id === row.id).map((r) => ({ ...r })) } }) }); } }, small: true });
      const move = (to) => { const next = moveItem(rows, i, to); rows.splice(0, rows.length, ...next); draw(); changed(); };
      return h("div", { class: "row-card cd-gift" }, photo.node,
        h("div", { class: "cells" }, cell(row, "name", t("Nama hadiah"), { maxlength: 80, placeholder: t("Mesin kopi") }), cell(row, "price", t("Harga"), { maxlength: 20, placeholder: "RM 350" }),
          cell(row, "url", t("Pautan kedai"), { maxlength: 300, type: "url", inputmode: "url", autocapitalize: "none", placeholder: "https://shopee.com.my/…" }), cell(row, "note", t("Catatan"), { maxlength: 100, placeholder: t("Warna putih") })),
        h("div", { class: "row-acts" },
          h("button", { type: "button", class: "iconbtn cd-small", "aria-label": t("Naik"), disabled: i === 0, onclick: () => move(i - 1) }, "↑"),
          h("button", { type: "button", class: "iconbtn cd-small", "aria-label": t("Turun"), disabled: i === rows.length - 1, onclick: () => move(i + 1) }, "↓"),
          h("button", { type: "button", class: "linkbtn bad", onclick: async () => {
            err.textContent = "";
            rows.splice(i, 1); changed();
            if (asset) { try { await media.remove(asset); return; } catch (e) { err.textContent = media.message(e); } }
            draw();
          } }, t("Padam"))));
    }));
    add.disabled = rows.length >= max;
  };
  draw();
  const node = h("div", { class: "field list" }, h("span", { class: "lab" }, t(field.label)), field.help ? h("span", { class: "muted cd-hint" }, t(field.help)) : null, body, add, err);
  return { node, setError: (m) => { err.textContent = m || ""; node.classList.toggle("bad", !!m); } };
}
