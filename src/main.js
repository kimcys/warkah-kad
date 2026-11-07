import "./style.css";
import { h } from "./lib/dom.js";
import { t } from "./lib/i18n.js";

// Routes:  /  the landing page     /app  the customer's pages (sign-in, then /app/cards: the builder)
// Anything else is a card address (served by the Worker before this app ever loads) or not found.
const app = document.getElementById("app");
let renderToken = 0;

export function go(path) {
  history.pushState({}, "", path);
  return render();
}
window.addEventListener("popstate", render);

async function render() {
  const token = ++renderToken;
  const path = location.pathname;
  const [slug = ""] = path.split("/").filter(Boolean);
  app.replaceChildren();
  document.title = "Warkah Kad";
  document.body.classList.toggle("site", slug === "");
  if (slug === "") {
    const { landing } = await import("./screens/landing.js");
    if (token !== renderToken) return;
    app.append(landing({ go }));
    return;
  }
  if (slug === "app") {
    document.title = t("Kad saya") + " · Warkah Kad";
    const { account } = await import("./screens/account.js");
    if (token !== renderToken) return;
    app.append(account({ go, path: path.split("/").filter(Boolean).slice(1) }));
    return;
  }
  app.append(h("main", { class: "page center pad2" }, h("h1", {}, t("Halaman tidak dijumpai")), h("p", { class: "muted" }, t("Alamat ini tiada kad yang diterbitkan.")), h("a", { class: "btn light", href: "/" }, t("Ke laman utama"))));
}

render();
