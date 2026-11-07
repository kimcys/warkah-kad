import { confirmDialog } from "../lib/confirm.js";
import { h, icon, toast } from "../lib/dom.js";
import { isSignedOut } from "../lib/session.js";
import { t } from "../lib/i18n.js";

// Staff tool at /app/admin: find the customer who wrote to us on WhatsApp, set the tier they chose and mark their card paid so they can publish.
// Only accounts with the admin role get past the server (api/src/routes/admin.ts); this screen also refuses everyone else.
const STATUS = { draft: t("Draf"), paid: t("Sudah dibayar"), live: t("Diterbitkan") };
const DOT = { draft: "#B98A3E", paid: "#2F7A4E", live: "#2F7A4E" };

export async function staffView(ctx) {
  const { api, go, show, page, header, signIn, wide } = ctx;
  const back = () => go("/app/cards");
  if (api.user?.role !== "admin") {
    show(page(header(t("Aktifkan kad"), back), h("p", { class: "muted center pad2" }, t("Halaman ini hanya untuk admin."))));
    return;
  }

  const results = h("div", { class: "stf-list" });
  const count = h("p", { class: "stf-count", role: "status" });
  const query = h("input", { class: "stf-in", type: "text", inputmode: "search", enterkeyhint: "search", placeholder: t("cth. aiman@gmail.com, aiman-alyana"), autocomplete: "off", "aria-label": t("Cari") });
  const clear = h("button", { type: "button", class: "stf-clear", "aria-label": t("Kosongkan"), hidden: true, onclick: () => { query.value = ""; clear.hidden = true; search(); query.focus(); } }, icon("close"));
  let tiers = [];
  let open = "";
  let seq = 0;

  /** One card, as a row: who, which address, which tier and state; opened it has the two actions. */
  function cardRow(c0, only) {
    const row = h("section", { class: "stf-row" });
    let card = c0;
    const draw = () => {
      const isOpen = only || open === card.id;
      const tierLabel = tiers.find((x) => x.id === card.tier)?.label || card.tier;
      row.replaceChildren(
        h("button", { type: "button", class: "stf-head", "aria-expanded": String(isOpen), onclick: () => { open = open === card.id ? "" : card.id; redraw(); } },
          h("span", { class: "stf-t" }, h("b", {}, card.names || card.slug), h("small", {}, `${card.ownerEmail} · /${card.slug}`)),
          h("span", { class: "stf-st" }, h("i", { style: `background:${DOT[card.status] || "#B98A3E"}` }), `${tierLabel} · ${STATUS[card.status] || card.status}`)),
        isOpen ? body() : null);
    };
    function body() {
      const err = h("p", { class: "err", role: "alert" });
      const select = h("select", { "aria-label": t("Pakej") }, ...tiers.map((x) => h("option", { value: x.id, selected: x.id === card.tier }, x.label)));
      const save = async (patch, done) => {
        err.textContent = "";
        try { const res = await api.adminSetCard(card.id, patch); card = { ...card, ...res.card }; toast(done, "check"); draw(); }
        catch (e) { if (isSignedOut(e)) return signIn(); console.error(e); err.textContent = t("Tidak dapat menyimpan. Cuba lagi."); }
      };
      const setTier = h("button", { class: "btn light slim", type: "button", onclick: () => save({ tier: select.value }, t("Pakej disimpan")) }, t("Simpan pakej"));
      const markPaid = card.status === "draft"
        ? h("button", { class: "btn primary slim", type: "button", onclick: async () => {
            const tierLabel = tiers.find((x) => x.id === select.value)?.label || select.value;
            if (!(await confirmDialog({ title: t("Tandakan sudah dibayar?"), text: `${card.ownerEmail}\n/${card.slug}\n${t("Pakej")}: ${tierLabel}`, confirmLabel: t("Tandakan") }))) return;
            save({ tier: select.value, paid: true }, t("Kad diaktifkan"));
          } }, icon("check"), t("Tandakan sudah dibayar"))
        : h("p", { class: "muted" }, card.status === "live" ? t("Kad ini sudah diterbitkan.") : t("Kad ini sudah dibayar. Pelanggan boleh menerbitkannya."));
      return h("div", { class: "stf-body" },
        h("div", { class: "stf-offer" }, h("label", { class: "stf-f" }, h("span", {}, t("Pakej")), select), h("div", { class: "cd-pv-acts" }, setTier, markPaid), err));
    }
    const redraw = () => { for (const r of results.children) r.draw?.(); };
    row.draw = draw;
    draw();
    return row;
  }

  // search as you type: one answer at a time (a slow earlier answer never replaces a newer one); a single match opens by itself
  async function search() {
    const mine = ++seq; const q = query.value.trim();
    clear.hidden = !query.value;
    count.textContent = t("Mencari…");
    try {
      const found = await api.adminCards(q);
      if (mine !== seq) return;
      tiers = found.tiers;
      count.textContent = found.cards.length ? (q ? t("{n} padanan", { n: found.cards.length }) : t("{n} kad terbaru", { n: found.cards.length })) : "";
      results.replaceChildren(...(found.cards.length ? found.cards.map((c) => cardRow(c, found.cards.length === 1)) : [h("div", { class: "stf-none" }, h("span", {}, t("Tiada padanan untuk {q}.", { q: `“${q}”` })), h("small", {}, t("Semak ejaan, atau cari dengan e-mel atau alamat kad.")))]));
    } catch (e) {
      if (mine !== seq) return;
      if (isSignedOut(e)) return signIn();
      console.error(e);
      count.textContent = e.status === 403 ? t("Akaun ini bukan admin.") : t("Tidak dapat mencari. Cuba lagi.");
    }
  }
  let timer = 0;
  query.addEventListener("input", () => { clearTimeout(timer); clear.hidden = !query.value; timer = setTimeout(search, 250); });
  query.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); search(); } });

  show(wide(page(header(t("Aktifkan kad"), back),
    h("div", { class: "stf" },
      h("p", { class: "stf-lead" }, t("Cari pelanggan yang menghubungi anda di WhatsApp, kemudian tandakan kadnya sudah dibayar selepas anda menerima bayaran.")),
      h("div", { class: "stf-search" }, icon("search"), query, clear), count, results))));
  search();
  requestAnimationFrame(() => query.focus());
}
