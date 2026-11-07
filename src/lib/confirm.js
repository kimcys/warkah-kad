import { h } from "./dom.js";
import { t } from "./i18n.js";

let counter = 0;

/**
 * A confirm box in the app's own look. The browser's own box looks different in every browser, cannot be styled and keeps the
 * phone's language. Resolves true when confirmed, false on cancel, Escape or a tap outside. A destructive confirm starts with
 * "cancel" focused, so Enter never deletes by accident.
 */
export function confirmDialog({ title, text = "", confirmLabel = t("OK"), cancelLabel = t("Batal"), danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const id = `confirm-${++counter}`;
    const finish = (ok) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      document.body.classList.remove("noscroll");
      prev?.focus?.();
      resolve(ok);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
      if (e.key === "Tab") { e.preventDefault(); (document.activeElement === cancel ? ok : cancel).focus(); } // two buttons: keep focus inside
    };
    const cancel = h("button", { class: "btn light", type: "button", onclick: () => finish(false) }, cancelLabel);
    const ok = h("button", { class: `btn primary${danger ? " danger-fill" : ""}`, type: "button", onclick: () => finish(true) }, confirmLabel);
    const overlay = h("div", { class: "confirm-scrim", onclick: (e) => { if (e.target === overlay) finish(false); } },
      h("div", { class: "confirm-box", role: "alertdialog", "aria-modal": "true", "aria-labelledby": `${id}-t`, "aria-describedby": `${id}-d` },
        h("h2", { id: `${id}-t`, class: "serif" }, title),
        text ? h("p", { id: `${id}-d` }, text) : null,
        h("div", { class: "confirm-actions" }, cancel, ok)));
    document.body.append(overlay);
    document.body.classList.add("noscroll");
    document.addEventListener("keydown", onKey);
    (danger ? cancel : ok).focus();
  });
}
