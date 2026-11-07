// The text in the code is Bahasa Malaysia. t("Malay text") returns the English version once an English dictionary is added to EN
// (English is planned for later); a missing translation falls back to the Malay text, so nothing breaks.
// Placeholders: t("Hantar semula dalam {n} s", { n: 30 }).
const EN = {};
let lang = "ms";
if (typeof document !== "undefined") document.documentElement.lang = lang;

export const getLang = () => lang;

export function t(ms, vars) {
  let text = (lang === "en" && EN[ms]) || ms;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
  return text;
}
