// A bottom sheet over the page (reactions + comments, and anything else that should not leave the wall).
import { h } from "./dom.js";

/** Opens a sheet containing `content` (a node or a function receiving close()). Returns { close }. */
export function openSheet(content) {
  const prevFocus = document.activeElement;
  const panel = h("div", { class: "bsheet", role: "dialog", "aria-modal": "true" }, h("div", { class: "grab" }));
  const overlay = h("div", { class: "scrim", onclick: (e) => { if (e.target === overlay) close(); } }, panel);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    document.body.classList.remove("noscroll");
    prevFocus?.focus?.();
  }
  panel.append(typeof content === "function" ? content(close) : content);
  document.body.append(overlay);
  document.body.classList.add("noscroll");
  document.addEventListener("keydown", onKey);
  requestAnimationFrame(() => overlay.classList.add("in"));
  return { close, panel };
}
