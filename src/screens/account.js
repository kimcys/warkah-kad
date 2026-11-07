import { h, icon } from "../lib/dom.js";
import { getApi } from "../lib/api.js";
import { t } from "../lib/i18n.js";
import { brandLock } from "../lib/brand.js";
import { signInView } from "./signin.js";
import { staffView } from "./staff.js";

// The customer's side, at /app: sign in with an emailed code, then the builder (/app/cards ...).
// Every page carries Warkah Kad's own bar (the wordmark and the way out), then its own title row.
export function account({ go, path = [] }) {
  const api = getApi();
  const view = h("div", { class: "acct" });
  let currentUser = null;
  const show = (...nodes) => { view.replaceChildren(...nodes); window.scrollTo(0, 0); };
  const signOut = h("button", { class: "linkbtn", onclick: async () => { await api.signOut(); signIn(); } }, t("Log keluar"));
  const page = (...nodes) => h("main", { class: "page" },
    h("div", { class: "brandbar" }, h("a", { href: "/", "aria-label": "Warkah Kad" }, brandLock()), h("span", { class: "brandright" }, currentUser?.role === "admin" ? h("button", { class: "linkbtn", onclick: () => go("/app/admin") }, "Admin") : null, currentUser ? signOut : null)),
    ...nodes);
  // On a laptop the pages use the whole window: "wide" pages fill it, the rest (forms) stay a readable width.
  const wide = (el) => (el.classList.add("wide"), el);
  const header = (title, back, right) => h("header", { class: "bar" },
    back ? h("button", { class: "iconbtn", "aria-label": t("Kembali"), onclick: back }, icon("back")) : null,
    h("h1", {}, title), right || null);
  const waiting = (title) => page(header(title), h("p", { class: "muted center pad2" }, t("Memuatkan…")));

  function signIn() {
    currentUser = null;
    show(signInView({ eyebrow: t("Warkah Kad"), title: t("Bina kad kahwin digital anda"), emailCode: api.emailCode, onDone: start }));
  }

  async function start() {
    show(waiting(t("Kad saya")));
    try { currentUser = await api.whenAuth(); } catch (e) {
      console.error(e);
      show(page(header(t("Kad saya")), h("p", { class: "err center pad2" }, t("Tidak dapat menyemak log masuk. Cuba lagi.")), h("div", { class: "page-pad" }, h("button", { class: "btn light", onclick: start }, t("Cuba lagi")))));
      return;
    }
    if (!currentUser) return signIn();
    route();
  }

  function route() {
    const ctx = { api, go, show, page, header, waiting, signIn, view, wide };
    const [section, ...rest] = path;
    if (section === "admin") return staffView(ctx);
    if (section === "cards") return import("./cards.js").then((m) => m.cardsView(ctx, rest));
    go("/app/cards");   // /app on its own is the list of cards
  }

  void start();
  return view;
}
