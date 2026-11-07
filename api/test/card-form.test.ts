import { describe, expect, it } from "vitest";
import { BUILDER_STEPS } from "@warkah/card-kit";
import { cardErrorMessage, createAutosaver, fieldVisible, listShape, progressText, readValue, savedText, stepForPath, stepStats, writeValue } from "../../src/lib/card-form.js";

const field = (path: string) => BUILDER_STEPS.flatMap((s) => s.fields).find((f) => f.path === path)!;
const draft = { couple: { groom: { name: "Ali", parentsHtml: "Hj. A bin B<br>&amp; Hjh. C binti D" } }, host: { parents: ["Hj. X", "Hjh. Y"] }, date: { start: "2027-03-20T11:00:00+08:00", end: "2027-03-20T16:00:00+08:00" } };

describe("reading a field from the draft", () => {
  it("text is as stored, and empty when missing", () => {
    expect(readValue(draft, field("couple.groom.name"))).toBe("Ali");
    expect(readValue(draft, field("couple.bride.name"))).toBe("");
  });
  it("parents show as one line each, whether stored as HTML or as a list", () => {
    expect(readValue(draft, field("couple.groom.parentsHtml"))).toBe("Hj. A bin B\n& Hjh. C binti D");
    expect(readValue(draft, field("host.parents"))).toBe("Hj. X\nHjh. Y");
    expect(readValue({}, field("host.parents"))).toBe("");
  });
  it("a date and time show as two boxes", () => {
    expect(readValue(draft, field("date.start"))).toEqual({ date: "2027-03-20", time: "11:00" });
    expect(readValue({}, field("date.start"))).toEqual({ date: "", time: "" });
  });
  it("a list is copied, so editing a row does not change the draft", () => {
    const d = { aturcara: [{ icon: "jam", label: "A", time: "1" }] };
    const rows = readValue(d, field("aturcara")) as any[];
    rows[0].label = "changed";
    expect(d.aturcara[0].label).toBe("A");
  });
  it("a number", () => {
    expect(readValue({ rsvp: { maxGuests: 3 } }, field("rsvp.maxGuests"))).toBe(3);
    expect(readValue({}, field("rsvp.maxGuests"))).toBe("");
  });
});

describe("what a change sends", () => {
  it("text: the value, or null when emptied (which removes it)", () => {
    expect(writeValue({}, field("venue.name"), "Dewan A")).toEqual({ venue: { name: "Dewan A" } });
    expect(writeValue({}, field("venue.name"), "   ")).toEqual({ venue: { name: null } });
  });
  it("parents: lines become the stored HTML (escaped), or a list for the host", () => {
    expect(writeValue({}, field("couple.groom.parentsHtml"), "Hj. A bin B\n& Hjh. C <b>\n\n")).toEqual({ couple: { groom: { parentsHtml: "Hj. A bin B<br>&amp; Hjh. C &lt;b&gt;" } } });
    expect(writeValue({}, field("host.parents"), "Hj. X\nHjh. Y")).toEqual({ host: { parents: ["Hj. X", "Hjh. Y"] } });
    expect(writeValue({}, field("host.parents"), "")).toEqual({ host: { parents: null } });
  });
  it("a start time waits for both boxes, then sets the end five hours later if there is none", () => {
    expect(writeValue({}, field("date.start"), { date: "2027-03-20", time: "" })).toBeNull();
    expect(writeValue({}, field("date.start"), { date: "2027-03-20", time: "11:00" })).toEqual({ date: { start: "2027-03-20T11:00:00+08:00", end: "2027-03-20T16:00:00+08:00" } });
  });
  it("moving the start keeps an end the customer already set, unless it is no longer after the start", () => {
    const kept = writeValue(draft, field("date.start"), { date: "2027-03-20", time: "12:00" });
    expect(kept).toEqual({ date: { start: "2027-03-20T12:00:00+08:00" } });
    const moved = writeValue(draft, field("date.start"), { date: "2027-03-20", time: "17:00" });
    expect((moved as any).date.end).toBe("2027-03-20T22:00:00+08:00");
  });
  it("the end alone is sent as it is", () => {
    expect(writeValue(draft, field("date.end"), { date: "2027-03-20", time: "18:00" })).toEqual({ date: { end: "2027-03-20T18:00:00+08:00" } });
  });
  it("a list drops rows nothing was typed in (an icon alone does not count)", () => {
    const rows = [{ icon: "makan", label: "Makan", time: "1 PM" }, { icon: "jam", label: "", time: "" }, { icon: "doa", label: " ", time: "" }];
    expect(writeValue({}, field("aturcara"), rows)).toEqual({ aturcara: [{ icon: "makan", label: "Makan", time: "1 PM" }] });
    expect(writeValue({}, field("aturcara"), [])).toEqual({ aturcara: [] });
  });
  it("a number, or null when cleared or not a number", () => {
    expect(writeValue({}, field("rsvp.maxGuests"), "4")).toEqual({ rsvp: { maxGuests: 4 } });
    expect(writeValue({}, field("rsvp.maxGuests"), "")).toEqual({ rsvp: { maxGuests: null } });
    expect(writeValue({}, field("rsvp.maxGuests"), "abc")).toEqual({ rsvp: { maxGuests: null } });
  });
  it("reading what was written gives back what was typed (parents and times)", () => {
    const d1 = { ...draft };
    const patch = writeValue(d1, field("couple.bride.parentsHtml"), "Hj. K bin Y\n& Hjh. R binti H");
    expect(readValue(patch as any, field("couple.bride.parentsHtml"))).toBe("Hj. K bin Y\n& Hjh. R binti H");
  });
});

describe("which fields show, and the list shapes", () => {
  it("hides the fields of a switch that is off", () => {
    expect(fieldVisible({ feature: "programme" }, { programme: false })).toBe(false);
    expect(fieldVisible({ feature: "programme" }, { programme: true })).toBe(true);
    expect(fieldVisible({}, { programme: false })).toBe(true);
    expect(fieldVisible({ feature: "x" }, undefined)).toBe(true);
  });
  it("the programme and contacts have their columns and limits", () => {
    expect(listShape("aturcara")!.max).toBe(12);
    expect(listShape("aturcara")!.columns.map((c: any) => c.key)).toEqual(["icon", "label", "time"]);
    expect((listShape("aturcara")!.columns[0] as any).options.map((o: any) => o.value)).toEqual(["jam", "pengantin", "makan", "akad", "doa", "bersurai"]);
    expect(listShape("contacts")!.columns.map((c: any) => c.key)).toEqual(["name", "role", "phone"]);
    expect(listShape("venue.name")).toBeNull();
  });
});

describe("steps", () => {
  it("finds the step a path belongs to", () => {
    expect(stepForPath("couple.groom.name")).toBe("pasangan");
    expect(stepForPath("aturcara.1.label")).toBe("majlis");
    expect(stepForPath("couple.model.bride")).toBe("gaya");
    expect(stepForPath("gallery.2.src")).toBe("gambar");
    expect(stepForPath("gifts.items")).toBe("tambahan");
    expect(stepForPath("slug")).toBe("terbit");
  });
  it("counts what is missing and what is wrong per step", () => {
    const status = { missing: [{ step: "pasangan" }, { step: "pasangan" }, { step: "majlis" }], problems: [{ path: "venue.maps" }, { path: "couple.groom.parentsHtml" }] };
    const stats = stepStats(status);
    expect(stats.pasangan).toEqual({ missing: 2, problems: 1 });
    expect(stats.majlis).toEqual({ missing: 1, problems: 1 });
    expect(stats.gaya).toEqual({ missing: 0, problems: 0 });
    expect(stepStats(undefined).terbit).toEqual({ missing: 0, problems: 0 });
  });
  it("says how far along they are", () => {
    expect(progressText({ ready: true, missing: [], problems: [] })).toMatch(/lengkap/);
    expect(progressText({ ready: false, missing: [1, 2], problems: [3] })).toBe("3 belum lengkap");
  });
  it("shows the time it was saved in Malaysia time", () => {
    expect(savedText(Date.parse("2027-03-20T06:02:00Z"))).toBe("Disimpan 14:02");
    expect(savedText(null)).toBe("");
  });
});

describe("what the customer is told", () => {
  it("a message for every answer the server gives", () => {
    for (const code of ["not_in_tier", "not_offered", "stale", "not_editable", "card_limit", "rate_limited", "too_large", "unsupported_type", "image_too_small", "image_too_large", "too_many", "invalid_input", "invalid_slug", "slug_taken"]) {
      expect(cardErrorMessage({ code, status: 400 }), code).not.toMatch(/Tidak dapat menyimpan/);
    }
    expect(cardErrorMessage({ status: 500 })).toMatch(/pelayan/);
    expect(cardErrorMessage({ status: 401 })).toMatch(/log masuk/);
    expect(cardErrorMessage(new Error("offline"))).toMatch(/sambungan/);
  });
});

// ---------- autosave, with a fake clock and a fake server
function rig(script: (call: number, patch: any, version: number) => any, opts: { delay?: number } = {}) {
  const tasks: { at: number; fn: () => void; id: number }[] = [];
  let clock = 0, nextId = 1, version = 1, calls: { patch: any; version: number }[] = [];
  const states: string[] = [], saved: any[] = [], stale: any[] = [];
  const timers = { set: (fn: () => void, ms: number) => { const id = nextId++; tasks.push({ at: clock + ms, fn, id }); return id; }, clear: (id: number) => { const i = tasks.findIndex((x) => x.id === id); if (i >= 0) tasks.splice(i, 1); } };
  const saver = createAutosaver({
    save: async (patch: any, v: number) => { calls.push({ patch, version: v }); const r = await script(calls.length, patch, v); return r; },
    getVersion: () => version,
    onSaved: (r: any) => { version = r.version; saved.push(r); },
    onStale: (b: any) => { if (b?.card) version = b.card.version; stale.push(b); },
    onState: (s: any) => states.push(s.state),
    timers: timers as any, now: () => 1_000_000 + clock, delay: opts.delay ?? 800, backoff: [2000, 5000]
  });
  const advance = async (ms: number) => {
    clock += ms;
    for (;;) {
      const due = tasks.filter((x) => x.at <= clock).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      tasks.splice(tasks.indexOf(due), 1);
      due.fn();
      await new Promise((r) => setTimeout(r, 0));
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return { saver, advance, calls: () => calls, states, saved, stale, version: () => version };
}
const ok = (v: number) => ({ version: v });
const refuse = (status: number, code: string) => Object.assign(new Error(code), { status, code });

describe("autosave", () => {
  it("waits for a pause, and sends everything typed meanwhile as one save", async () => {
    const r = rig((n) => ok(n + 1));
    r.saver.change({ venue: { name: "D" } });
    await r.advance(300);
    r.saver.change({ venue: { name: "De", area: "KL" } });
    await r.advance(300);
    r.saver.change({ couple: { first: "bride" } });
    expect(r.calls()).toHaveLength(0);
    await r.advance(900);
    expect(r.calls()).toHaveLength(1);
    expect(r.calls()[0]).toEqual({ patch: { venue: { name: "De", area: "KL" }, couple: { first: "bride" } }, version: 1 });
    expect(r.saver.state).toBe("saved");
    expect(r.version()).toBe(2);
    expect(r.saver.dirty).toBe(false);
  });

  it("sends the next version with the next save", async () => {
    const r = rig((n) => ok(n + 1));
    r.saver.change({ a: 1 }); await r.advance(900);
    r.saver.change({ b: 2 }); await r.advance(900);
    expect(r.calls().map((c) => c.version)).toEqual([1, 2]);
  });

  it("an edit made while a save is under way goes out straight after it", async () => {
    let release!: () => void;
    const r = rig((n) => (n === 1 ? new Promise((res) => (release = () => res(ok(2)))) : ok(3)));
    r.saver.change({ a: 1 }); await r.advance(900);
    expect(r.saver.state).toBe("saving");
    r.saver.change({ b: 2 });
    release(); await r.advance(10);
    await r.advance(900);
    expect(r.calls().map((c) => c.patch)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(r.calls()[1].version).toBe(2);
    expect(r.saver.state).toBe("saved");
  });

  it("another save got there first (409): tries again on top of the newer version, and nothing is lost", async () => {
    const r = rig((n, patch, v) => { if (n === 1) throw Object.assign(refuse(409, "stale"), { body: { card: { version: 5 } } }); return ok(v + 1); });
    r.saver.change({ venue: { name: "X" } });
    await r.advance(900);
    await r.advance(10);
    expect(r.calls().map((c) => [c.version, c.patch])).toEqual([[1, { venue: { name: "X" } }], [5, { venue: { name: "X" } }]]);
    expect(r.stale).toHaveLength(1);
    expect(r.saver.state).toBe("saved");
    expect(r.version()).toBe(6);
  });

  it("gives up with a conflict when it stays stale", async () => {
    const r = rig(() => { throw Object.assign(refuse(409, "stale"), { body: { card: { version: 9 } } }); });
    r.saver.change({ a: 1 });
    await r.advance(900); await r.advance(10); await r.advance(10); await r.advance(10);
    expect(r.saver.state).toBe("conflict");
    expect(r.saver.pending).toEqual({ a: 1 });           // still there to resend
  });

  it("retries a dropped connection with a growing pause, then saves", async () => {
    const r = rig((n) => { if (n < 3) throw new Error("offline"); return ok(2); });
    r.saver.change({ a: 1 });
    await r.advance(900);
    expect(r.saver.state).toBe("retrying");
    await r.advance(2000);
    expect(r.saver.state).toBe("retrying");
    await r.advance(5000);
    expect(r.calls()).toHaveLength(3);
    expect(r.saver.state).toBe("saved");
    expect(r.calls().every((c) => c.version === 1)).toBe(true);
  });

  it("stops retrying after a few tries and says so, keeping the edit", async () => {
    const r = rig(() => { throw new Error("offline"); });
    r.saver.change({ a: 1 });
    await r.advance(900); await r.advance(2000); await r.advance(5000); await r.advance(20000);
    expect(r.saver.state).toBe("error");
    expect(r.calls()).toHaveLength(3);
    expect(r.saver.pending).toEqual({ a: 1 });
    r.saver.retry();
    await r.advance(10);
    expect(r.calls()).toHaveLength(4);
  });

  it("a refusal (not in the package, invalid) is reported once and not retried", async () => {
    const r = rig(() => { throw refuse(403, "not_in_tier"); });
    r.saver.change({ features: { gifts: true } });
    await r.advance(900); await r.advance(30000);
    expect(r.calls()).toHaveLength(1);
    expect(r.saver.state).toBe("refused");
    expect(r.saver.pending).toBeNull();
  });

  it("flush saves what is waiting without the pause", async () => {
    const r = rig((n) => ok(n + 1));
    r.saver.change({ a: 1 });
    const state = await r.saver.flush();
    expect(state).toBe("saved");
    expect(r.calls()).toHaveLength(1);
    expect(r.saver.dirty).toBe(false);
  });

  it("flush waits for a save already under way and for what was typed after it", async () => {
    let release!: () => void;
    const r = rig((n) => (n === 1 ? new Promise((res) => (release = () => res(ok(2)))) : ok(3)));
    r.saver.change({ a: 1 }); await r.advance(900);
    r.saver.change({ b: 2 });
    const done = r.saver.flush();
    release();
    expect(await done).toBe("saved");
    expect(r.calls().map((c) => c.patch)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("flush with nothing to save returns at once", async () => {
    const r = rig(() => ok(2));
    expect(await r.saver.flush()).toBe("idle");
    expect(r.calls()).toHaveLength(0);
  });

  it("an offline flush does not hang", async () => {
    const r = rig(() => { throw new Error("offline"); });
    r.saver.change({ a: 1 });
    expect(await r.saver.flush()).toBe("retrying");
    expect(r.saver.dirty).toBe(true);
  });
});

import { blankGift, featureRows, isBlankGift, moveItem, nextGiftId, planImage, versionedUrl } from "../../src/lib/card-form.js";
import { ASSET_RULES, OFFERED_FEATURES, TIERS } from "@warkah/card-kit";

const rule = (key: string) => ASSET_RULES.find((r: any) => r.key === key)!;

describe("fitting a picture to its rule", () => {
  it("scales a big photo down to the longest edge allowed", () => {
    const p: any = planImage({ width: 4000, height: 3000 }, rule("gallery"));
    expect(p.ok).toBe(true);
    expect(Math.max(p.width, p.height)).toBe(1400);
    expect(p.width / p.height).toBeCloseTo(4 / 3, 2);
  });
  it("leaves a picture alone when it already fits", () => {
    expect(planImage({ width: 900, height: 1200 }, rule("gallery"))).toMatchObject({ ok: true, scale: 1, width: 900, height: 1200 });
  });
  it("refuses a picture that is too small", () => {
    expect(planImage({ width: 300, height: 400 }, rule("cover"))).toEqual({ ok: false, reason: "too_small" });
    expect(planImage({ width: 0, height: 0 }, rule("cover"))).toEqual({ ok: false, reason: "unreadable" });
  });
  it("cuts a square from the middle for gifts", () => {
    const p: any = planImage({ width: 1600, height: 1000 }, rule("gift"), { square: true });
    expect(p.crop).toEqual({ x: 300, y: 0, size: 1000 });
    expect(p.width).toBe(600);
    expect(p.height).toBe(600);
  });
  it("judges a square by its short side", () => {
    expect(planImage({ width: 2000, height: 200 }, rule("gift"), { square: true })).toEqual({ ok: false, reason: "too_small" });
  });
});

describe("gift rows", () => {
  it("picks the lowest id not used by a row or a stored file", () => {
    expect(nextGiftId([])).toBe("g1");
    expect(nextGiftId([{ id: "g1" }, { id: "g3" }])).toBe("g2");
    expect(nextGiftId([{ id: "g1" }], ["gifts/g2.webp"])).toBe("g3");
  });
  it("a row with only its id is blank", () => {
    expect(isBlankGift(blankGift("g1"))).toBe(true);
    expect(isBlankGift({ ...blankGift("g1"), name: " x " })).toBe(false);
  });
});

describe("moving and caching", () => {
  it("moves an item and leaves the original list alone", () => {
    const a = [1, 2, 3];
    expect(moveItem(a, 0, 2)).toEqual([2, 3, 1]);
    expect(a).toEqual([1, 2, 3]);
    expect(moveItem(a, 0, 5)).toEqual([1, 2, 3]);
  });
  it("a replaced file gets a new address", () => {
    expect(versionedUrl("/x.webp", { createdAt: 5 })).toBe("/x.webp?v=5");
    expect(versionedUrl("/x.webp", undefined)).toBe("/x.webp");
  });
});

describe("the feature list", () => {
  const tier = (id: string) => (TIERS as any[]).find((t) => t.id === id);
  const feats = OFFERED_FEATURES as any[];
  it("lists pages before extras, and never the ones that are not offered", () => {
    const rows = featureRows(feats, {}, tier("full"));
    expect(rows.map((r) => r.key)).not.toContain("kenang");
    const firstAddon = rows.findIndex((r) => r.group === "addon");
    expect(rows.slice(firstAddon).every((r) => r.group === "addon")).toBe(true);
  });
  it("the basic package locks the extras; the full package locks nothing", () => {
    expect(featureRows(feats, {}, tier("basic")).find((r) => r.key === "gifts")!.locked).toBe(true);
    expect(featureRows(feats, {}, tier("basic")).find((r) => r.key === "gallery")!.locked).toBe(false);
    expect(featureRows(feats, {}, tier("full")).some((r) => r.locked)).toBe(false);
  });
  it("on follows the effective features", () => {
    expect(featureRows(feats, { gifts: true }, tier("full")).find((r) => r.key === "gifts")!.on).toBe(true);
    expect(featureRows(feats, {}, tier("full")).find((r) => r.key === "gifts")!.on).toBe(false);
  });
});

describe("dress code colours", () => {
  it("is a list of colours, and a row where only the pickers moved is still blank", () => {
    expect(listShape("dressCode.colors")!.blank).toEqual({ label: "", tone: "blue", icon: "shirt" });
    const f = BUILDER_STEPS.flatMap((s: any) => s.fields).find((x: any) => x.path === "dressCode.colors")!;
    expect(writeValue({}, f, [{ label: "", tone: "pink", icon: "dress" }, { label: "Biru", tone: "blue", icon: "shirt" }])).toEqual({ dressCode: { colors: [{ label: "Biru", tone: "blue", icon: "shirt" }] } });
  });
});

import { expiryText, previewPanelState, previewWorking } from "../../src/lib/card-form.js";
describe("the preview panel", () => {
  it("shows what the server's state means", () => {
    expect(previewPanelState(null)).toBe("none");
    expect(previewPanelState({ state: "none", stale: true })).toBe("none");
    expect(previewPanelState({ state: "queued", stale: true })).toBe("working");
    expect(previewPanelState({ state: "building", stale: false })).toBe("working");
    expect(previewPanelState({ state: "failed", stale: true })).toBe("failed");
    expect(previewPanelState({ state: "ready", stale: false })).toBe("ready");
    expect(previewPanelState({ state: "ready", stale: true })).toBe("outdated");
    expect(previewWorking({ state: "queued" })).toBe(true);
    expect(previewWorking({ state: "ready", stale: false })).toBe(false);
  });
  it("says when the link stops working, in Malaysia time", () => {
    expect(expiryText(null)).toBe("");
    expect(expiryText(Date.parse("2027-03-20T17:00:00Z"))).toBe("Pautan sah sehingga 21 Mar");   // 01:00 on the 21st in Kuala Lumpur
  });
});

import { publishGate, publishPanelState } from "../../src/lib/card-form.js";
describe("may the customer publish?", () => {
  const ok = { card: { status: "paid" }, status: { ready: true }, preview: { state: "ready", stale: false } };
  it("yes once paid, complete and previewed as it is now", () => {
    expect(publishGate(ok)).toEqual({ ok: true, reason: null });
    expect(publishGate({ ...ok, card: { status: "live" } }).ok).toBe(true);
  });
  it("says what is in the way, in the order they fix it", () => {
    expect(publishGate({ ...ok, card: { status: "draft" }, status: { ready: false } }).reason).toBe("payment");
    expect(publishGate({ ...ok, status: { ready: false } }).reason).toBe("incomplete");
    expect(publishGate({ ...ok, preview: null }).reason).toBe("preview");
    expect(publishGate({ ...ok, preview: { state: "ready", stale: true } }).reason).toBe("preview");
    expect(publishGate({ ...ok, preview: { state: "building", stale: true } }).reason).toBe("preview");
    expect(publishGate({ ...ok, preview: { state: "failed", stale: true } }).reason).toBe("preview");
  });
  it("shows the publish panel state", () => {
    expect(publishPanelState(null)).toBe("none");
    expect(publishPanelState({ state: "queued" })).toBe("working");
    expect(publishPanelState({ state: "live", changed: false })).toBe("live");
    expect(publishPanelState({ state: "live", changed: true })).toBe("changed");
    expect(publishPanelState({ state: "failed" })).toBe("failed");
  });
});
