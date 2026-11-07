import { h, icon } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { brandLock } from "../lib/brand.js";

// Sign-in page, in Warkah's own look: cream paper, the wordmark, one action: an emailed six-digit code, no password. The code is valid for
// 10 minutes, can be asked for again after 60 seconds, and is thrown away after five wrong tries.
export function signInView({ eyebrow, title, emailCode, lead = t("Masukkan e-mel anda. Kami akan menghantar kod 6 digit untuk log masuk, tanpa kata laluan."), onDone, error = "" }) {
  const notice = h("div", { class: "signnote", role: "alert", hidden: true });
  /** A problem in the shape of the design: an icon, what happened in a few words, and what to do. */
  const fail = (heading, body = "") => {
    notice.replaceChildren(icon("alert"), h("span", { class: "msg" }, h("strong", {}, heading), body ? h("span", {}, body) : null));
    notice.hidden = false;
  };
  const clear = () => { notice.hidden = true; };
  if (error) fail(error);
  const heading = h("h1", {}, title);
  const leadEl = h("p", { class: "lead" }, lead);
  // on the code step the page asks for the code, so the title says so and the first lead goes
  const onStep = (n) => { heading.textContent = n === 2 ? t("Masukkan kod") : title; leadEl.hidden = n === 2; };
  const actions = codeForm(emailCode, onDone, fail, clear, onStep);
  return h("main", { class: "page signin" },
    h("div", { class: "brandbar" }, h("a", { href: "/", "aria-label": "Warkah Kad" }, brandLock())),
    h("div", { class: "signbody" },
      eyebrow ? h("p", { class: "gold-eyebrow" }, eyebrow) : null,
      heading, leadEl,
      ...actions,
      notice,
      h("p", { class: "signlegal" }, t("Dengan log masuk, anda bersetuju dengan "), h("a", { href: "/terma", target: "_blank", rel: "noopener" }, t("Terma")), t(" dan "), h("a", { href: "/privasi", target: "_blank", rel: "noopener" }, t("Notis Privasi")), ".")));
}

const isOffline = (e) => e instanceof TypeError || e?.name === "TypeError" || e?.name === "AbortError" || e?.name === "TimeoutError";
const RESEND_SECONDS = 60;

function codeForm({ request, verify }, onDone, fail, clear, onStep) {
  const emailBox = h("input", { class: "signinput", id: "sign-email", type: "email", inputmode: "email", autocomplete: "email", placeholder: "nama@contoh.com" });
  const emailErr = h("span", { class: "signfield-err", role: "alert", hidden: true });
  const code = h("input", { class: "signinput code", id: "sign-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", placeholder: "••••••", "aria-label": t("Kod 6 digit") });
  const send = h("button", { class: "btn primary", type: "button" }, t("Hantar kod"));
  const confirm = h("button", { class: "btn primary", type: "button" }, t("Log masuk"));
  const resend = h("button", { class: "hh-link", type: "button" });
  const change = h("button", { class: "hh-link", type: "button" }, t("Tukar e-mel"));
  const sentTo = h("p", { class: "signhint" });
  const step1 = h("div", { class: "signstep" },
    h("label", { class: "signlabel", for: "sign-email" }, t("E-mel")), emailBox, emailErr, send);
  const step2 = h("div", { class: "signstep", hidden: true }, sentTo, code, confirm, h("div", { class: "signalt" }, resend, change));

  let timer = 0;
  let needNew = false; // after five wrong tries the code is gone: the only way on is a new one
  const countdown = () => {
    clearInterval(timer);
    let left = RESEND_SECONDS;
    const tick = () => {
      resend.disabled = left > 0;
      resend.textContent = left > 0 ? t("Hantar semula dalam {n} s", { n: left }) : (needNew ? t("Hantar kod baharu") : t("Hantar semula"));
      if (left-- <= 0) clearInterval(timer);
    };
    tick(); timer = setInterval(tick, 1000);
  };
  const busy = (btn, on, label) => { btn.disabled = on; btn.textContent = on ? t("Sebentar…") : label; };

  async function ask(fromStep) {
    clear(); emailErr.hidden = true;
    const to = emailBox.value.trim();
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) { emailErr.textContent = t("Sila masukkan e-mel yang sah."); emailErr.hidden = false; step1.hidden = false; step2.hidden = true; onStep(1); emailBox.focus(); return; }
    busy(send, true, "");
    try {
      await request(to);
      needNew = false;
      sentTo.replaceChildren(t("Kod dihantar ke "), h("b", {}, to), t(". Ia sah selama 10 minit. Semak juga folder spam."));
      step1.hidden = true; step2.hidden = false; onStep(2); code.value = ""; code.classList.remove("bad"); code.focus(); countdown();
    } catch (e) {
      console.error(e);
      if (isOffline(e)) fail(t("Tiada sambungan internet"), t("Semak sambungan anda dan cuba lagi."));
      else if (e.code === "rate_limited") fail(t("Terlalu banyak percubaan"), t("Cuba lagi nanti."));
      else if (e.code === "retry_later") fail(t("Tunggu sebentar"), t("Kod baru sahaja dihantar. Cuba lagi selepas seminit."));
      else if (e.code === "invalid_email") { emailErr.textContent = t("Sila masukkan e-mel yang sah."); emailErr.hidden = false; }
      else fail(t("Kod tidak dapat dihantar"), t("Cuba lagi sebentar."));
    }
    busy(send, false, t("Hantar kod"));
  }
  async function check() {
    clear(); code.classList.remove("bad");
    if (code.value.trim().length < 6) return;
    busy(confirm, true, "");
    try { await verify(emailBox.value.trim(), code.value.trim()); await onDone(); return; } catch (e) {
      console.error(e);
      code.classList.add("bad");
      if (isOffline(e)) fail(t("Tiada sambungan internet"), t("Semak sambungan anda dan cuba lagi."));
      else if (e.code === "too_many_attempts") { needNew = true; fail(t("Kod baharu diperlukan"), t("Terlalu banyak cubaan dengan kod ini. Minta kod baharu.")); countdown(); }
      else if (e.code === "rate_limited") fail(t("Terlalu banyak percubaan, cuba lagi nanti"), t("Tunggu sebentar sebelum mencuba lagi."));
      else if (e.code === "invalid_code") fail(t("Kod tidak betul atau sudah tamat"), t("Semak kod dalam e-mel, atau minta kod baharu."));
      else fail(t("Log masuk gagal"), t("Cuba lagi sebentar."));
      code.focus();
    }
    busy(confirm, false, t("Log masuk"));
  }
  send.addEventListener("click", () => ask());
  emailBox.addEventListener("keydown", (e) => e.key === "Enter" && ask());
  confirm.addEventListener("click", check);
  code.addEventListener("input", () => { code.value = code.value.replace(/\D/g, "").slice(0, 6); if (code.value.length === 6) check(); }); // six digits: no need to press anything
  resend.addEventListener("click", () => ask());
  change.addEventListener("click", () => { clear(); clearInterval(timer); step2.hidden = true; step1.hidden = false; onStep(1); emailBox.focus(); });
  return [step1, step2];
}
