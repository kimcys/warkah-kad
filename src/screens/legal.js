import "../landing.css";
import { h } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { brandLock } from "../lib/brand.js";
import { LEGAL, LEGAL_UPDATED_LABEL } from "../lib/legal-content.js";

// /privasi (privacy notice) and /terma (terms of service). The text lives in src/lib/legal-content.js.
function legalPage({ go }, kind) {
  const doc = LEGAL[kind];
  const other = kind === "privacy" ? "/terma" : "/privasi";
  document.title = `${doc.title} · Warkah Kad`;
  const numbered = doc.sections.filter((s) => s.h);
  const link = (path) => (e) => { e.preventDefault(); go(path); };
  return h("div", { class: "lp" },
    h("header", { class: "lp-bar" },
      h("a", { href: "/", class: "lp-brand", "aria-label": "Warkah Kad", onclick: link("/") }, brandLock("maroon", "Warkah Kad")),
      h("nav", {}, h("a", { href: "/app/cards", onclick: link("/app/cards") }, t("Log masuk")))),
    h("main", { class: "legal" }, h("div", { class: "legal-wrap" },
      h("article", { class: "legal-paper" },
        h("img", { class: "legal-seal", src: "/brand/seal.webp", alt: "", width: 72, height: 72 }),
        h("h1", {}, doc.title),
        h("p", { class: "legal-date" }, `${t("Dikemas kini")}: ${LEGAL_UPDATED_LABEL}`),
        h("p", { class: "legal-intro" }, doc.intro),
        h("nav", { class: "legal-toc", "aria-label": t("Kandungan") }, h("ol", {}, numbered.map((s) => h("li", {}, h("a", { href: `#${s.id}`, onclick: (e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, s.h))))),
        ...doc.sections.map((s) => h("section", { id: s.id },
          s.h ? h("h2", {}, s.h) : null,
          ...(s.p || []).map((text) => h("p", {}, text)),
          s.ul ? h("ul", {}, s.ul.map((item) => h("li", {}, item))) : null)),
        h("p", { class: "legal-other" }, h("a", { href: other, onclick: link(other) }, kind === "privacy" ? t("Baca Terma Perkhidmatan") : t("Baca Notis Privasi")))))));
}

export const privacyPage = (ctx) => legalPage(ctx, "privacy");
export const termsPage = (ctx) => legalPage(ctx, "terms");
