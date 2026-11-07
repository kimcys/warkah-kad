import { h } from "./dom.js";

/** The Warkah logo lock-up for a page header: the wax seal beside the hand-lettered wordmark (both are the brand files, never retyped). */
export function brandLock(tone = "maroon", alt = "warkah") {
  return h("span", { class: "brand-lock" },
    h("img", { class: "brand-seal", src: "/brand/seal.webp", alt: "", width: 44, height: 44 }),
    h("img", { class: "brand-word", src: `/brand/wordmark-${tone}.png`, alt, height: "26" }));
}
