// The browser's client for the Warkah Kad API (api/: a Worker with D1 and R2).
//
// It talks to the API on its own origin: the API refuses cross-origin writes and its session cookie is same-origin. In production the site is
// served by the same Worker; in development Vite proxies /api to it (see vite.config.js).
//
//   sign-in   email code (/api/auth/otp/*)
//   builder   /api/catalogue, /api/cards/...
//
// `base` and `fetch` are injectable so the client can be tested against the real API without a browser.
const enc = encodeURIComponent;

/**
 * @param {object} [options]
 * @param {string} [options.base] origin prefix for every request; "" (the default) means the page's own origin
 * @param {typeof fetch} [options.fetch]
 */
export function createApi({ base = "", fetch: fetchImpl } = {}) {
  const send = fetchImpl || ((...args) => fetch(...args));
  let user = null;
  let catalogue = null; // the builder's catalogue, once fetched

  /** JSON in, JSON out. Failures throw an Error carrying `.status` and `.code`; `.body` holds the answer (e.g. the current card on a 409 stale). */
  async function api(path, { method = "GET", json, form, fresh = false } = {}) {
    const init = { method, credentials: "same-origin", headers: {} };
    if (fresh) init.cache = "no-store"; // skip the browser's short cache: the customer must see their own changes
    if (json !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(json); }
    if (form) init.body = form; // the browser sets the multipart boundary itself
    const res = await send(`${base}${path}`, init);
    const body = (res.headers.get("content-type") || "").includes("application/json") ? await res.json().catch(() => null) : null;
    if (!res.ok) throw Object.assign(new Error(body?.error || `http_${res.status}`), { status: res.status, code: body?.error || `http_${res.status}`, body });
    // A static host answering an unknown path with index.html is "no API here", not data.
    if (body === null) throw Object.assign(new Error("not_json"), { status: res.status, code: "not_json" });
    return body;
  }

  return {
    /* ----- sign-in: a code sent by email ----- */
    emailCode: {
      request: (email) => api("/api/auth/otp/request", { method: "POST", json: { email } }),
      async verify(email, code) {
        user = (await api("/api/auth/otp/verify", { method: "POST", json: { email, code } })).user;
        return user;
      }
    },
    async whenAuth() {
      try { user = (await api("/api/auth/me")).user; } catch (err) {
        if (err.status !== 401 && err.code !== "not_json") throw err;
        user = null;
      }
      return user;
    },
    get user() { return user; },
    async signOut() {
      await api("/api/auth/logout", { method: "POST", json: {} }).catch(() => {});
      user = null;
    },

    /* ----- the builder: the catalogue and the customer's cards ----- */
    /** Themes, palettes, models, features, tiers, form steps, upload rules and samples. The same for everyone, so it is fetched once per page. */
    loadCatalogue() { return (catalogue ||= api("/api/catalogue").catch((e) => { catalogue = null; throw e; })); },
    listCards: async () => (await api("/api/cards")).cards,
    createCard: (body = {}) => api("/api/cards", { method: "POST", json: body }),
    getCard: (id) => api(`/api/cards/${enc(id)}`, { fresh: true }),
    /** Autosave: a merge patch on the draft, checked against the version the browser last saw. A 409 error carries the current card in .body. */
    saveCard: (id, baseVersion, patch) => api(`/api/cards/${enc(id)}`, { method: "PATCH", json: { baseVersion, patch } }),
    checkCardSlug: (id, value) => api(`/api/cards/${enc(id)}/slug?value=${enc(value)}`),
    setCardSlug: (id, slug) => api(`/api/cards/${enc(id)}/slug`, { method: "PUT", json: { slug } }),
    getCardPreview: (id) => api(`/api/cards/${enc(id)}/preview`, { fresh: true }),
    startCardPreview: (id) => api(`/api/cards/${enc(id)}/preview`, { method: "POST", json: {} }),
    getCardPublish: (id) => api(`/api/cards/${enc(id)}/publish`, { fresh: true }),
    publishCard: (id) => api(`/api/cards/${enc(id)}/publish`, { method: "POST", json: {} }),
    unpublishCard: (id) => api(`/api/cards/${enc(id)}/unpublish`, { method: "POST", json: {} }),
    /** kind: cover | portrait | gallery | gift | qr | music; slot: groom / bride for portraits, g1.. for gift photos. */
    uploadCardAsset(id, kind, file, slot) {
      const form = new FormData();
      form.set("kind", kind);
      if (slot) form.set("slot", slot);
      form.set("file", file, file.name || "upload");
      return api(`/api/cards/${enc(id)}/assets`, { method: "POST", form });
    },
    deleteCardAsset: (id, assetId) => api(`/api/cards/${enc(id)}/assets/${enc(assetId)}`, { method: "DELETE" }),
    /** Where the editor shows one of the customer's own uploads (private to them). */
    cardFileUrl: (id, path) => `${base}/api/cards/${enc(id)}/files/${path.split("/").map(enc).join("/")}`
  };
}

let shared = null;
/** The one client the pages share. */
export const getApi = () => (shared ||= createApi());
