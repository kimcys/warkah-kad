// Tiny helpers: build elements, escape text, toast, icons.
import { WK_ICONS, ICON_ALIASES } from "./icons.js";
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "muted") el.muted = true;   // the attribute alone does not mute a script-created <video>, so autoplay would be blocked
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let toastTimer;
let toastHide;
/** One toast at a time, bottom centre: an ink pill with a tick (or another icon), 2.4 s. Announced to screen readers; reduced motion only fades. */
export function toast(message, iconName = "check") {
  const el = document.getElementById("toast");
  clearTimeout(toastTimer);
  clearTimeout(toastHide);
  el.replaceChildren(icon(iconName), h("span", {}, message));
  el.hidden = false;
  el.classList.remove("in");
  void el.offsetWidth; // restart the rise when a second toast replaces the first
  el.classList.add("in");
  toastTimer = setTimeout(() => { el.classList.remove("in"); toastHide = setTimeout(() => (el.hidden = true), 300); }, 2400);
}

// Older stroke icons that the v2 set (src/lib/icons.js) has no drawing for yet; every other name resolves to the v2 icon.
const LEGACY = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/>',
  images: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  loop: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  forward: '<path d="M9 18l6-6-6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  flip: '<path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0121 19"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M4 12l16-8-6 16-2-7z"/>',
  quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  book: '<path d="M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2z M4 19V5"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  strip: '<rect x="7" y="2" width="10" height="20" rx="1"/><path d="M7 8.5h10M7 15h10"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>'
};

export const icon = (name) => {
  const span = document.createElement("span");
  span.className = "ico";
  const key = ICON_ALIASES[name] || name;
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${WK_ICONS[key] || LEGACY[name] || ""}</svg>`;
  return span;
};
