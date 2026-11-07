import "../landing.css";
import catalogue from "@warkah/card-kit/catalogue.json";
import { h, icon } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { brandLock } from "../lib/brand.js";

// The public front page of Warkah Kad. Everything on it is a plain fact about the product; no prices are shown while they are still being decided
// (the tiers come from the card kit, but only their names and what they include are used here).
const WHATSAPP = "60172655375";   // the same number the API reports as CONTACT_WHATSAPP; shown here so the page needs no request
const wa = (text) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

const STEPS = [
  ["edit", t("Isi butiran"), t("Nama pengantin, tarikh, tempat dan atur cara. Anda hanya taip sekali, dan semuanya disimpan sendiri.")],
  ["heart", t("Pilih rupa kad"), t("Pilih tema, warna dan model pengantin. Setiap perubahan boleh dilihat serta-merta.")],
  ["eye", t("Lihat pratonton penuh"), t("Lihat kad anda sendiri, lengkap dengan nama dan gambar anda, sebelum membuat sebarang keputusan.")],
  ["send", t("Terbit dan kongsi"), t("Kad anda mendapat satu pautan yang cantik. Hantar melalui WhatsApp kepada tetamu.")]
];

const FAQ = [
  [t("Adakah saya perlu pandai teknologi?"), t("Tidak. Anda hanya mengisi borang langkah demi langkah dan memilih rupa. Kad dibina untuk anda.")],
  [t("Bagaimana tetamu melihat kad?"), t("Melalui satu pautan. Tiada aplikasi untuk dimuat turun. Ia dibuka terus di telefon mereka.")],
  [t("Bolehkah saya ubah kad selepas diterbitkan?"), t("Boleh. Ubah butiran, lihat pratonton baharu, kemudian terbitkan semula. Pautan kad anda kekal sama.")],
  [t("Siapa boleh melihat pratonton saya?"), t("Hanya orang yang anda beri pautan pratonton. Ia tidak muncul di Google dan tamat selepas tujuh hari.")],
  [t("Bagaimana pembayaran dibuat?"), t("Buat masa ini kami mengaktifkan kad anda selepas anda menghubungi kami melalui WhatsApp. Pembayaran dalam talian akan menyusul.")]
];

export function landing({ go }) {
  const start = (e) => { e.preventDefault(); go("/app/cards"); };
  const cta = (cls = "btn primary") => h("a", { class: cls, href: "/app/cards", onclick: start }, t("Bina kad anda"));

  const themes = catalogue.themes.map((th) => h("figure", { class: "lp-theme" },
    th.thumbnails?.opening ? h("img", { src: `/builder/${th.thumbnails.opening.replace(/^samples\//, "")}`, alt: "", loading: "lazy", decoding: "async" }) : h("div", { class: "lp-theme-blank" }),
    h("figcaption", {}, h("strong", {}, th.label?.ms || th.name), h("span", {}, th.description?.ms || ""))));

  const featureNames = catalogue.features.filter((f) => f.key !== "kenang" && f.key !== "guestName" && !f.hidden).map((f) => f.label);
  const tiers = catalogue.tiers.filter((x) => x.id !== "custom").map((x) => h("article", { class: "lp-tier" },
    h("h3", {}, x.label),
    h("p", {}, x.note?.replace(/\s*PROPOSED.*$/, "") || ""),
    h("ul", {}, ...catalogue.features.filter((f) => x.features.includes(f.key)).map((f) => h("li", {}, icon("check"), f.label)))));
  const custom = catalogue.tiers.find((x) => x.id === "custom");

  return h("div", { class: "lp" },
    h("header", { class: "lp-bar" },
      h("a", { href: "/", class: "lp-brand", "aria-label": "Warkah Kad" }, brandLock("maroon", "Warkah Kad")),
      h("nav", {}, h("a", { href: "/app/cards", onclick: start }, t("Log masuk")))),

    h("section", { class: "lp-hero" },
      h("div", { class: "lp-hero-copy" },
        h("p", { class: "lp-eyebrow" }, t("Warkah Kad")),
        h("h1", {}, t("Kad kahwin digital anda, siap dalam beberapa minit.")),
        h("p", { class: "lp-lead" }, t("Pilih tema, isi butiran dan lihat kad anda sendiri sebelum diterbitkan. Kemudian kongsi dengan satu pautan melalui WhatsApp.")),
        h("div", { class: "lp-cta" }, cta(), h("a", { class: "btn light", href: "#cara" }, t("Lihat caranya")))),
      h("div", { class: "lp-hero-art", "aria-hidden": "true" },
        ...catalogue.themes.slice(0, 3).map((th, i) => th.thumbnails?.opening ? h("img", { class: `lp-card lp-card-${i + 1}`, src: `/builder/${th.thumbnails.opening.replace(/^samples\//, "")}`, alt: "", decoding: "async" }) : null))),

    h("section", { class: "lp-sec", id: "cara" },
      h("h2", {}, t("Empat langkah mudah")),
      h("ol", { class: "lp-steps" }, ...STEPS.map(([ic, title, body], i) => h("li", {},
        h("span", { class: "lp-num" }, String(i + 1)), h("span", { class: "lp-ico" }, icon(ic)), h("h3", {}, title), h("p", {}, body))))),

    h("section", { class: "lp-sec lp-alt" },
      h("h2", {}, t("Pilih rupa yang sesuai dengan majlis anda")),
      h("p", { class: "lp-sub" }, t("Setiap tema ada pilihan warna dan model pengantin. Anda boleh bertukar tema pada bila-bila masa sebelum menerbitkan.")),
      h("div", { class: "lp-themes" }, ...themes)),

    h("section", { class: "lp-sec" },
      h("h2", {}, t("Apa yang ada dalam kad anda")),
      h("ul", { class: "lp-feats" }, ...featureNames.map((n) => h("li", {}, icon("check"), n)))),

    h("section", { class: "lp-sec lp-alt", id: "pakej" },
      h("h2", {}, t("Pakej")),
      h("p", { class: "lp-sub" }, t("Pilih pakej yang sesuai. Anda boleh mula membina dan melihat pratonton dahulu, tanpa sebarang bayaran.")),
      h("div", { class: "lp-tiers" }, ...tiers),
      custom ? h("p", { class: "lp-custom" }, h("strong", {}, custom.label + ": "), (custom.note || "").replace(/\s*PROPOSED.*$/, "")) : null,
      h("p", { class: "lp-sub" }, h("a", { class: "btn light slim", href: wa("Salam, saya berminat dengan Warkah Kad. Boleh tahu harga pakej?"), target: "_blank", rel: "noopener noreferrer" }, t("Tanya harga di WhatsApp")))),

    h("section", { class: "lp-sec" },
      h("h2", {}, t("Soalan lazim")),
      h("div", { class: "lp-faq" }, ...FAQ.map(([q, a]) => h("details", {}, h("summary", {}, q), h("p", {}, a))))),

    h("section", { class: "lp-final" },
      h("h2", {}, t("Mulakan kad anda hari ini")),
      h("p", {}, t("Percuma untuk membina dan melihat pratonton.")),
      cta("btn cream")),

    h("footer", { class: "lp-foot" },
      brandLock("cream", "Warkah Kad"),
      h("p", {}, t("Warkah Kad. Kad kahwin digital yang dibina oleh anda.")),
      h("p", { class: "lp-links" }, h("a", { href: "/terma", onclick: (e) => { e.preventDefault(); go("/terma"); } }, t("Terma")), " · ", h("a", { href: "/privasi", onclick: (e) => { e.preventDefault(); go("/privasi"); } }, t("Privasi"))),
      h("a", { href: wa("Salam, saya ada pertanyaan tentang Warkah Kad."), target: "_blank", rel: "noopener noreferrer" }, t("Hubungi kami di WhatsApp"))));
}
