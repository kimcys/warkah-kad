// The Warkah icon set (v2): 24 px grid, 1.75 px rounded stroke, lightly irregular hand-drawn lines, coloured by the surrounding text.
// Drawn by Claude Design (docs/ui-audit/v2/warkah-ui.js); the paths below are that file's, written as a module.
const C = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const P = (d) => `<path d="${d}"/>`;
const R = (x, y, w, h, r) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;

const V2 = {
    camera: P('M3.2 8.6c0-1.1.8-2 1.9-2h2.4l1.5-2.2h6.1l1.6 2.2h2.3c1.1 0 1.9.9 1.9 2v9.2c0 1.1-.8 1.9-1.9 1.9H5.1c-1.1 0-1.9-.8-1.9-1.9z') + C(12, 12.9, 3.5),
    photo: R(3.4, 4.6, 17.2, 14.8, 2) + P('M4 17.4l4.7-4.9 3.2 3.1 2.7-2.5 5.4 4.8') + C(15.6, 9, 1.4),
    video: R(3, 6.6, 12.4, 10.8, 2) + P('M15.4 10.6l5.4-3.1v9l-5.4-3.1'),
    voice: P('M12 3.4c1.6 0 2.8 1.3 2.8 2.9v5.1c0 1.6-1.2 2.9-2.8 2.9s-2.8-1.3-2.8-2.9V6.3c0-1.6 1.2-2.9 2.8-2.9z') + P('M6.2 11.1c.2 3.3 2.6 5.9 5.8 5.9s5.6-2.6 5.8-5.9') + P('M12 17.1v3.5M9 20.6h6.1'),
    wish: R(4.2, 3.4, 15.6, 17.2, 1.6) + P('M7.6 8.4h8.9M7.6 12h8.6M7.6 15.6h5.2'),
    qr: P('M4 4.1h6v5.9H4zM14 4h6v6h-6zM4 14h6v6H4z') + P('M14 14h2.6v2.6M20 14.1v.1M14.1 20h.1M17.4 17.5h2.6v2.6h-2.6z'),
    print: P('M7 9V3.9h10V9') + P('M5.6 17.5H4.3c-.7 0-1.3-.6-1.3-1.3v-5.5c0-1 .8-1.7 1.7-1.7h14.6c1 0 1.7.8 1.7 1.7v5.5c0 .7-.6 1.3-1.3 1.3h-1.3') + P('M7 14.1h10v6.1H7z'),
    tv: R(2.8, 5, 18.4, 12.4, 1.8) + P('M8.4 21h7.2M12 17.4V21'),
    heart: P('M12 20.1s-7.5-4.4-8.4-9.5C3.1 7.4 5.2 5 7.9 5c1.8 0 3.2 1 4.1 2.6C12.9 6 14.3 5 16.1 5c2.7 0 4.8 2.4 4.3 5.6-.8 5.1-8.4 9.5-8.4 9.5z'),
    seal: P('M12 3.4c2.3-.2 3.7 1 5.3 1.7 1.9.8 3.1 2.4 3.3 4.5.1 1.5.9 2.6.6 4.2-.4 2.2-2 3.7-3.7 4.8-1.6 1-3.4 1.9-5.5 1.7-2.4-.2-4.5-1.2-5.9-3C4.9 15.8 3.5 14 3.6 11.5c.1-2.4 1.6-4.2 3.2-5.6C8.3 4.6 10 3.6 12 3.4z') + C(12, 12, 3.6),
    envelope: R(3, 5.6, 18, 12.8, 1.7) + P('M3.6 6.7l8.4 6.5 8.4-6.6'),
    postmark: C(8.6, 12, 5.4) + P('M6.2 12h4.8') + P('M15.4 8.6c1-.7 2-.7 3 0s2 .7 2.9.1M15.4 12c1-.7 2-.7 3 0s2 .7 2.9.1M15.4 15.4c1-.7 2-.7 3 0s2 .7 2.9.1'),
    link: P('M10.1 13.9a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.7-5.6l-1 1') + P('M13.9 10.1a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.7 5.6l1-1'),
    whatsapp: P('M12 3.6c4.7 0 8.4 3.5 8.4 7.9s-3.7 7.9-8.4 7.9c-1.3 0-2.6-.3-3.7-.8L4 19.8l1.2-3.8c-.9-1.3-1.5-2.8-1.5-4.5 0-4.4 3.7-7.9 8.3-7.9z') + P('M9.4 9.1c.2 2.5 2.6 4.9 5.2 5.4l1-1.2-1.6-1-.9.6c-.9-.4-1.6-1.1-2-2l.6-.9-1-1.6z'),
    calendar: R(3.8, 5.2, 16.4, 15, 1.8) + P('M3.8 10h16.4M8.2 3.3v3.6M15.8 3.3v3.6') + P('M8.4 14h.1M12 14h.1M15.6 14h.1M8.4 17.2h.1M12 17.2h.1'),
    place: P('M12 21s-6.5-5.6-6.5-11.1C5.5 6.3 8.4 3.5 12 3.5s6.5 2.8 6.5 6.4C18.5 15.4 12 21 12 21z') + C(12, 10, 2.4),
    lock: R(5, 10.5, 14, 10, 1.8) + P('M8 10.5V7.8c0-2.3 1.8-4 4-4s4 1.7 4 4v2.7') + P('M12 14.4v2.3'),
    check: P('M4.6 12.7l4.6 4.4L19.4 6.9'),
    download: P('M12 4v11M7.4 10.6l4.6 4.6 4.6-4.6M4.5 19.5h15'),
    share: P('M12 3.8v11M8 7.6l4-3.8 4 3.8') + P('M7.5 10.5H6.2c-1 0-1.7.8-1.7 1.7v6.4c0 1 .8 1.7 1.7 1.7h11.6c1 0 1.7-.8 1.7-1.7v-6.4c0-1-.8-1.7-1.7-1.7h-1.3'),
    language: P('M3.5 5.6h9M8 3.5v2.1M5.3 5.6c.8 3.3 3 5.8 6.2 7.2M11 5.6c-.8 3.6-3.4 6.5-7.2 8') + P('M12.6 20.5l3.7-8.9 3.9 8.9M13.9 17.6h4.9'),
    sound: P('M4 9.5h3.2l4.3-4v13l-4.3-4H4z') + P('M15 9.1c.9.8 1.4 1.8 1.4 2.9s-.5 2.2-1.4 3M17.8 6.5c1.6 1.4 2.6 3.4 2.6 5.5s-1 4.1-2.6 5.5'),
    soundOff: P('M4 9.5h3.2l4.3-4v13l-4.3-4H4z') + P('M15.6 9.6l4.9 4.9M20.5 9.6l-4.9 4.9'),
    frame: R(4, 3.4, 16, 17.2, 1) + P('M7.1 6.5h9.8v8.6H7.1z') + P('M9 18h6'),
    strip: R(7, 2.8, 10, 18.4, 1.2) + P('M7 9h10M7 15h10'),
    boomerang: P('M12 12c-1.8-2.4-3.2-3.6-5-3.6a3.6 3.6 0 0 0 0 7.2c1.8 0 3.2-1.2 5-3.6s3.2-3.6 5-3.6a3.6 3.6 0 0 1 0 7.2c-1.8 0-3.2-1.2-5-3.6z'),
    eye: P('M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z') + C(12, 12, 2.8),
    hide: P('M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z') + C(12, 12, 2.8) + P('M4.2 4.2l15.6 15.6'),
    swipe: P('M9.6 5.4l7 1.5-2.4 11.2-7-1.5z') + P('M3.2 20.1c2.5.7 4.9.7 7.3 0') + P('M8.9 18.7l1.6 1.4-1.3 1.6'),
    undo: P('M8.5 8.5H15c2.8 0 5 2.2 5 5s-2.2 5-5 5H9') + P('M11.5 5.2L8.2 8.5l3.3 3.3'),
    search: C(10.5, 10.5, 6.2) + P('M15.2 15.2l5 5'),
    user: C(12, 8.2, 3.8) + P('M4.8 20.2c.8-3.6 3.6-5.6 7.2-5.6s6.4 2 7.2 5.6'),
    arrow: P('M4.5 12h15M13.6 6l5.9 6-5.9 6'),
    close: P('M6 6l12 12M18 6L6 18'),
    plus: P('M12 5v14M5 12h14'),
    copy: R(8.5, 8.5, 11.5, 11.5, 1.6) + P('M15.5 8.5V5.6c0-.9-.7-1.6-1.6-1.6H5.6C4.7 4 4 4.7 4 5.6v8.3c0 .9.7 1.6 1.6 1.6h2.9'),
    clock: C(12, 12, 8.6) + P('M12 7.4V12l3.1 2.1'),
    edit: P('M14.6 5.4l4 4L8.4 19.6H4.4v-4z') + P('M12.5 7.5l4 4'),
  };

// A tiny deterministic wobble per icon name, so the lines look hand-drawn but never change between renders.
const wobble = (name, d) => {
  if (/[aA]/.test(d)) return d; // arcs are left alone
  let s = 0;
  for (let i = 0; i < name.length; i++) s = (s * 31 + name.charCodeAt(i)) % 9973;
  return d.replace(/-?\d*\.?\d+/g, (n) => { s = (s * 9301 + 49297) % 233280; return " " + (+n + (s / 233280 - 0.5) * 0.32).toFixed(2); }); // a space first: "1.9.8" is two numbers and must stay two
};
export const WK_ICONS = {};
for (const k of Object.keys(V2)) WK_ICONS[k] = V2[k].replace(/d="([^"]+)"/g, (m, d) => `d="${wobble(k, d)}"`);

/** Older names used across the screens, mapped to their v2 drawing. */
export const ICON_ALIASES = { images: "photo", pen: "edit", mic: "voice", loop: "boomerang", users: "user", timer: "clock", chat: "wish" };

/** An icon as a CSS background-image value, drawn in `color` (for places an <svg> cannot go). */
export const iconUrl = (name, color = "#2B1B18", size = 24) => {
  const key = ICON_ALIASES[name] || name;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${WK_ICONS[key] || ""}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
