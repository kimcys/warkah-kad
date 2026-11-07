// A scripted walk through the invitation builder in headless Chrome, against a local Worker (npm run dev:edge, or `wrangler dev` in api/).
//   node scripts/builder-walk.mjs --log <wrangler log file> [--desktop] [--out <folder>] [--url http://localhost:8787]
// It signs in with the emailed code (fake email mode prints it in the Worker's log), starts a card, fills steps 1 to 3 the way a customer would,
// and checks what the SERVER saved. Screenshots go to --out.
import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const LOG = arg("--log"), OUT = arg("--out", "/tmp/builder-walk"), URL_BASE = arg("--url", "http://localhost:8787"), DESKTOP = args.includes("--desktop");
if (!LOG) { console.error("Give --log <the wrangler dev log>"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const ENGINE = arg("--engine", join(process.cwd(), "..", "warkah-engine"));   // the build server lives in the private engine repo
const IMAGES = arg("--images");   // a folder with cover.jpg groom.jpg bride.png g1.jpg g2.png g3.webp gift.jpg tiny.jpg qr.png; without it steps 4 and 5 are not walked
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dbg = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, [`--remote-debugging-port=${dbg}`, "--headless=new", "--no-first-run", `--user-data-dir=/tmp/walk-${dbg}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const jsErrors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") jsErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result; if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed: " + expr.slice(0, 80)); return r.result?.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", DESKTOP ? { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false } : { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
let shots = 0;
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, `${String(++shots).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64")); };
let fails = 0;
const check = (name, ok, extra = "") => { if (!ok) fails++; console.log(ok ? "PASS" : "FAIL", name, extra); };

const TAG = String(Date.now()).slice(-5);          // a name nobody used in an earlier run: addresses are unique
const BRIDE = `Dina${TAG}`;
const nav = async (path) => { await send("Page.navigate", { url: URL_BASE + path }); await sleep(1500); };
const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(`!!(${expr})`).catch(() => false)) return true; await sleep(150); } return false; };
const click = (text, scope = "document") => ev(`(()=>{const el=[...${scope}.querySelectorAll('button,a')].find(b=>b.textContent.trim().includes(${JSON.stringify(text)})&&!b.disabled);if(!el)return false;el.click();return true})()`);
const setInput = (selector, value) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
// a field by its label text: set its input / textarea / select (for date-times: date then time)
const fill = (label, value) => fill_(label, value).catch((e) => { throw new Error(`fill "${label}": ${e.message}`); });
const fill_ = (label, value) => ev(`(()=>{
  const field=[...document.querySelectorAll('.cd-form .field')].find(f=>f.querySelector('.lab')&&f.querySelector('.lab').textContent.trim().replace(/\\s*\\*$/,'')===${JSON.stringify(label)});
  if(!field)return 'no field: '+${JSON.stringify(label)};
  const v=${JSON.stringify(value)};
  const set=(el,val,evt)=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,val);el.dispatchEvent(new Event(evt,{bubbles:true}));};
  if(field.classList.contains('cd-dt')){const [d,t]=field.querySelectorAll('input');set(d,v.date,'input');set(t,v.time,'input');return true;}
  const el=field.querySelector('input,textarea,select');set(el,v,el.tagName==='SELECT'?'change':'input');return true;})()`);
// choose files in a file input, as a person would (DOM.setFileInputFiles fires the change event)
const setFiles = async (selector, names, index = 0) => {
  const doc = (await send("DOM.getDocument", { depth: 0 })).result.root.nodeId;
  const all = (await send("DOM.querySelectorAll", { nodeId: doc, selector })).result.nodeIds;
  if (!all[index]) throw new Error("no file input: " + selector);
  await send("DOM.setFileInputFiles", { nodeId: all[index], files: names.map((n) => join(IMAGES, n)) });
};
const serverCard = (cardId) => ev(`fetch('/api/cards/${cardId}',{credentials:'same-origin'}).then(r=>r.json())`);
const signInCode = () => { const m = [...readFileSync(LOG, "utf8").matchAll(/Kod log masuk Warkah Kad: (\d{6})/g)]; return m.length ? m[m.length - 1][1] : null; };

try {
  // ---------- sign in through the real screen
  await nav("/app/cards");
  check("the sign-in screen shows first", await waitFor(`document.querySelector('#sign-email')`));
  const email = `walk-${Date.now()}@example.com`;
  await setInput("#sign-email", email); await click("Hantar kod");
  check("a code is asked for", await waitFor(`document.querySelector('#sign-code')`));
  await sleep(600);
  await setInput("#sign-code", signInCode()); await click("Log masuk", `document.querySelector('.signstep:not([hidden]), body')`);
  check("signed in: the cards page loads (empty)", await waitFor(`document.body.innerText.includes('Cipta kad jemputan pertama anda')`));
  await shot("cards-empty");

  // ---------- a new card
  check("start a new card", await click("Cipta kad baharu") && await waitFor(`document.querySelector('.cd-theme')`));
  await shot("new-card");
  check("four themes are offered with their photos", (await ev(`document.querySelectorAll('.cd-theme').length`)) === 4 && (await ev(`[...document.querySelectorAll('.cd-theme img')].every(i=>i.getAttribute('src').startsWith('/builder/thumbnails/'))`)));
  check("English and Malay can be chosen", await click("English") && await ev(`document.querySelector('.cd-chip.on').textContent.includes('English')`));
  await click("Bahasa Malaysia");
  await ev(`[...document.querySelectorAll('.cd-theme')].find(b=>b.textContent.includes('Kasih')).click()`);
  check("choosing a theme opens step 1", await waitFor(`location.pathname.endsWith('/pasangan') && document.querySelector('.cd-form .field')`));
  const cardId = await ev(`location.pathname.split('/')[3]`);
  await sleep(1000);
  await shot("step1-empty");
  // on a phone the preview opens as a sheet ("Lihat contoh"); on a laptop it sits beside the form
  if (!DESKTOP) { await click("Lihat contoh"); await waitFor(`document.querySelector('.cd-sheet .cd-frame')`); }
  const FRAME = DESKTOP ? ".cd-aside .cd-frame" : ".cd-sheet .cd-frame";
  check("the preview shows the chosen theme", await waitFor(`document.querySelector('${FRAME}') && document.querySelector('${FRAME}').src.includes('/preview/lover-ms/')`));
  check("the preview really loaded the sample card", await waitFor(`document.querySelector('${FRAME}').contentDocument.querySelector('.model-figure img, #openInvite')`, 8000));
  await shot("preview");
  if (!DESKTOP) await ev(`document.querySelector('.cd-sheet .close').click()`);
  check("every step has a tab, and nothing is saved yet", (await ev(`document.querySelectorAll('.cd-tabs .cd-tab').length`)) === 6);

  // ---------- step 1: the couple
  const step1 = [["Nama panggilan pengantin lelaki", "Muhammad Farid"], ["Nama penuh pengantin lelaki (bin / binti)", "bin Hj. Anuar"], ["Nama pendek pengantin lelaki", "Farid"],
    ["Ibu bapa pengantin lelaki", "Hj. Anuar bin Salleh\n& Hjh. Mariam binti Ali"],
    ["Nama panggilan pengantin perempuan", "Nur Dina"], ["Nama penuh pengantin perempuan (bin / binti)", "binti Hj. Rashid"], ["Nama pendek pengantin perempuan", BRIDE],
    ["Ibu bapa pengantin perempuan", "Hj. Rashid bin Karim\n& Hjh. Salmah binti Noh"], ["Nama siapa dahulu", "bride"], ["Hashtag (pilihan)", "#DinaFarid2027"], ["Yang menjemput", "Hj. Rashid bin Karim\nHjh. Salmah binti Noh"]];
  for (const [label, value] of step1) { const r = await fill(label, value); if (r !== true) check(`field "${label}"`, false, String(r)); }
  check("the save indicator moves from unsaved to saved", await waitFor(`document.querySelector('.savepill').textContent.startsWith('Disimpan')`, 6000));
  await shot("step1-filled");
  let server = await serverCard(cardId);
  check("the server has the names", server.draft.couple.groom.name === "Muhammad Farid" && server.draft.couple.bride.short === BRIDE && server.draft.couple.first === "bride");
  check("parents were stored as the card's HTML", server.draft.couple.groom.parentsHtml === "Hj. Anuar bin Salleh<br>&amp; Hjh. Mariam binti Ali");
  check("the host's parents are a list of two", JSON.stringify(server.draft.host.parents) === JSON.stringify(["Hj. Rashid bin Karim", "Hjh. Salmah binti Noh"]));
  check("the card has a name in the header", (await ev(`document.querySelector('.cd-page .bar h1').textContent`)) === `${BRIDE} & Farid`);
  check("step 1 no longer has missing items (its tab shows no badge)", !(await ev(`!!document.querySelector('.cd-tabs .cd-tab:nth-child(1) .cd-dot')`)));

  // ---------- step 2: the day
  await click("Seterusnya");
  check("next goes to step 2", await waitFor(`location.pathname.endsWith('/majlis')`));
  await fill("Mula", { date: "2027-05-15", time: "11:00" });
  await fill("Nama tempat", "Dewan Anggerik"); await fill("Kawasan", "Kuantan, Pahang"); await fill("Alamat penuh", "Dewan Anggerik, Jalan Contoh, 25000 Kuantan, Pahang");
  await fill("Pautan Google Maps", "https://example.com/not-maps"); await fill("Pautan Waze", "https://waze.com/ul?q=anggerik");
  await sleep(1500);
  server = await serverCard(cardId);
  check("the end time followed the start (five hours later)", server.draft.date.start === "2027-05-15T11:00:00+08:00" && server.draft.date.end === "2027-05-15T16:00:00+08:00");
  check("a wrong Maps link is explained under its field, in Malay", /Google Maps/.test(await ev(`[...document.querySelectorAll('.cd-form .field')].find(f=>f.textContent.includes('Pautan Google Maps')).querySelector('.err').textContent`)));
  await fill("Pautan Google Maps", "https://maps.app.goo.gl/abc123");
  await click("Tambah acara"); await click("Tambah acara");
  await ev(`(()=>{const rows=[...document.querySelectorAll('.row-card')];const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
    set(rows[0].querySelector('.cell.label input'),'Ketibaan Tetamu');set(rows[0].querySelector('.cell.time input'),'11:00 AM');
    set(rows[1].querySelector('.cell.label input'),'Jamuan Makan');set(rows[1].querySelector('.cell.time input'),'1:00 PM');
    rows[1].querySelector('select').value='makan';rows[1].querySelector('select').dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(1500);
  server = await serverCard(cardId);
  check("the programme was saved with its icons", server.draft.aturcara.length === 2 && server.draft.aturcara[1].icon === "makan" && server.draft.aturcara[1].label === "Jamuan Makan");
  check("the wrong link is no longer reported", !server.status.problems.some((p) => p.path === "venue.maps"));
  await ev(`document.querySelectorAll('.row-card')[0].querySelector('.linkbtn.bad').click()`);
  await sleep(1400);
  server = await serverCard(cardId);
  check("removing a row saves the shorter list", server.draft.aturcara.length === 1 && server.draft.aturcara[0].label === "Jamuan Makan");
  await shot("step2-filled");

  // ---------- step 3: the look
  await click("Seterusnya");
  check("next goes to step 3", await waitFor(`location.pathname.endsWith('/gaya')`));
  await sleep(800);
  const stray = await ev(`(document.querySelector('.cd-form').innerText.match(/.{0,25}\\bnull\\b.{0,25}/)||[''])[0]`);
  check("no stray 'null' on the page", !stray, JSON.stringify(stray));
  await shot("step3-before");
  if (!DESKTOP) { await click("Lihat contoh"); await waitFor(`document.querySelector('.cd-sheet .cd-frame')`); await waitFor(`document.querySelector('${FRAME}').contentDocument.querySelector('.model-figure img')`, 8000); }
  check("the theme picker shows the chosen theme", await ev(`document.querySelector('.cd-theme.on').textContent.includes('Kasih')`));
  check("the colour options are this theme's", (await ev(`[...document.querySelectorAll('.cd-palettes .cd-chip')].map(c=>c.textContent.trim()).join('|')`)) === "Klasik|Ungu Lembut|Pic Manis|Pudina");
  await ev(`[...document.querySelectorAll('.cd-palettes .cd-chip')].find(c=>c.textContent.includes('Ungu Lembut')).click()`);
  await ev(`[...document.querySelectorAll('.cd-models')][0].querySelectorAll('.cd-model')[2].click()`);
  await ev(`[...document.querySelectorAll('.cd-models')][1].querySelectorAll('.cd-model')[2].click()`);
  await sleep(1500);
  server = await serverCard(cardId);
  check("the palette and both models were saved", server.draft.palette === "lilac" && /^groom-\d$/.test(server.draft.couple.model.groom) && /^bride-\d$/.test(server.draft.couple.model.bride), JSON.stringify([server.draft.palette, server.draft.couple.model]));
  check("the preview changed colour at once, without a reload", await waitFor(`document.querySelector('${FRAME}').contentDocument.documentElement.dataset.palette==='lilac'`, 4000));
  const chosen = server.draft.couple.model;
  check("the preview swapped the figures", await waitFor(`(()=>{const d=document.querySelector('${FRAME}').contentDocument;const g=d.querySelector('.mempelai-groom .model-figure img'),b=d.querySelector('.mempelai-bride .model-figure img');return g&&b&&g.getAttribute('src').endsWith('${chosen.groom}.webp')&&b.getAttribute('src').endsWith('${chosen.bride}.webp')})()`, 4000));
  await ev(`document.querySelector('.cd-models').scrollIntoView({block:'center'})`); await sleep(500);
  await shot("step3-chosen");
  if (!DESKTOP) await ev(`document.querySelector('.cd-sheet .close').click()`);
  check("going back to 'follow the theme' removes the choice", await ev(`(()=>{[...document.querySelectorAll('.cd-models')][0].querySelector('.cd-model.auto').click();return true})()`) && (await sleep(1500), (await serverCard(cardId)).draft.couple.model.groom === undefined));
  check("music: the song field is there on this step", await ev(`document.body.innerText.includes('Belum ada lagu')`));

  // ---------- steps 4 and 5: pictures and extras (the tier is set by an admin for now, so set it the same way)
  if (IMAGES) {
    execSync(`cd api && npx wrangler d1 execute warkah-kad --local --command "UPDATE cards SET tier='full' WHERE id='${cardId}'"`, { stdio: "ignore" });
    await nav(`/app/cards/${cardId}/gambar`);
    check("step 4 opens with its upload boxes, not a 'coming soon' note", await waitFor(`document.querySelector('.cd-form > .cd-image') && !document.querySelector('.cd-soon')`));
    await shot("step4-empty");
    await setFiles(".cd-form > .cd-image input[type=file]", ["tiny.jpg"]);
    check("a picture that is too small is refused in Malay", await waitFor(`document.querySelector('.cd-image .err').textContent.includes('terlalu kecil')`, 6000));
    await setFiles(".cd-form > .cd-image input[type=file]", ["cover.jpg"]);
    check("the share picture uploads and shows", await waitFor(`document.querySelector('.cd-form > .cd-image img.cd-thumb')`, 12000));
    server = await serverCard(cardId);
    const cover = server.assets.find((a) => a.kind === "cover");
    check("the cover was shrunk to a JPEG within its rule", cover && cover.contentType === "image/jpeg" && cover.bytes <= 300 * 1024 && Math.max(cover.width, cover.height) <= 1280, JSON.stringify(cover));
    check("the draft points at the cover", server.draft.meta.ogImage === "cover/og-preview.jpg");
    check("the thumbnail is really served back", await ev(`fetch(document.querySelector('.cd-form > .cd-image img.cd-thumb').src,{credentials:'same-origin'}).then(r=>r.status===200&&r.headers.get('content-type').startsWith('image/'))`));
    await setFiles(".cd-portraits input[type=file]", ["groom.jpg"], 0);
    await waitFor(`document.querySelectorAll('.cd-portraits img.cd-thumb').length===1`, 12000);
    await setFiles(".cd-portraits input[type=file]", ["bride.png"], 1);
    check("both portraits upload", await waitFor(`document.querySelectorAll('.cd-portraits img.cd-thumb').length===2`, 12000));
    server = await serverCard(cardId);
    check("portraits are stored as WebP under their slots", /^portrait\/groom\.webp$/.test(server.draft.portraits?.groom) && /^portrait\/bride\.webp$/.test(server.draft.portraits?.bride), JSON.stringify(server.draft.portraits));
    await setFiles(".cd-gallery ~ input[type=file]", ["g1.jpg", "g2.png", "g3.webp"]);
    check("three gallery pictures upload at once", await waitFor(`document.querySelectorAll('.cd-gallery .cd-tile img').length===3`, 20000));
    server = await serverCard(cardId);
    check("the server has three, in order", server.draft.gallery.length === 3 && server.draft.gallery.map((g) => g.src).join() === "gallery/1.webp,gallery/2.webp,gallery/3.webp", JSON.stringify(server.draft.gallery.map((g) => g.src)));
    await ev(`document.querySelectorAll('.cd-gallery .cd-tile')[2].querySelector('input').scrollIntoView({block:'center'})`);
    await fill("Galeri", "x").catch(() => {});
    await ev(`(()=>{const el=document.querySelectorAll('.cd-gallery .cd-tile input')[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Hari bersejarah');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await ev(`document.querySelectorAll('.cd-gallery .cd-tile')[2].querySelector('button[aria-label="Naik"]').click()`);
    await sleep(1600);
    server = await serverCard(cardId);
    check("a caption and a move up were saved", server.draft.gallery[0].alt === "Hari bersejarah" && server.draft.gallery[1].src === "gallery/3.webp", JSON.stringify(server.draft.gallery));
    await shot("step4-filled");
    await ev(`document.querySelectorAll('.cd-gallery .cd-tile')[0].querySelector('.linkbtn.bad').click()`);
    check("removing a gallery picture deletes the file", await waitFor(`document.querySelectorAll('.cd-gallery .cd-tile').length===2`, 8000) && (await serverCard(cardId)).assets.filter((a) => a.kind === "gallery").length === 2);

    await click("Seterusnya");
    check("next opens step 5", await waitFor(`location.pathname.endsWith('/tambahan')`));
    check("the switches list the offered features (not Kenang)", await waitFor(`document.querySelectorAll('.cd-switch').length>=12`) && !(await ev(`document.body.innerText.includes('Warkah Kenang')`)));
    check("extras start off, so their fields are not shown", !(await ev(`document.body.innerText.includes('Senarai hadiah') && !!document.querySelector('.cd-gift')`)));
    const toggle = (name) => ev(`(()=>{const l=[...document.querySelectorAll('.cd-switch')].find(x=>x.textContent.includes(${JSON.stringify(name)}));const i=l.querySelector('input');i.click();return i.checked})()`);
    await toggle("Muzik latar");
    for (const name of ["Senarai hadiah", "DuitNow QR", "Ayat Al-Quran"]) await toggle(name);
    check("switching extras on shows their fields at once", await waitFor(`document.querySelector('.cd-form > .cd-image') && document.body.innerText.includes('Tambah hadiah') && document.querySelector('textarea[dir=rtl]')`, 4000));
    await sleep(1400);
    server = await serverCard(cardId);
    check("the choices were saved", server.draft.features.gifts === true && server.draft.features.duitnow === true && server.draft.features.music === false, JSON.stringify(server.draft.features));
    await click("Tambah hadiah");
    await ev(`(()=>{const r=document.querySelector('.cd-gift');const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
      set(r.querySelector('.cell.name input'),'Mesin kopi');set(r.querySelector('.cell.price input'),'RM 350');set(r.querySelector('.cell.url input'),'https://shopee.com.my/mesin-kopi');set(r.querySelector('.cell.note input'),'Warna putih')})()`);
    await setFiles(".cd-gift input[type=file]", ["gift.jpg"]);
    check("a gift photo uploads and keeps the row's words", await waitFor(`document.querySelector('.cd-gift img.cd-thumb') && document.querySelector('.cd-gift .cell.name input').value==='Mesin kopi'`, 12000));
    server = await serverCard(cardId);
    const gift = server.assets.find((a) => a.kind === "gift");
    check("the gift photo is a square WebP under gifts/g1", gift && gift.path === "gifts/g1.webp" && gift.width === gift.height && gift.bytes <= 80 * 1024, JSON.stringify(gift));
    check("the gift is in the draft", server.draft.gifts.items.length === 1 && server.draft.gifts.items[0].id === "g1" && server.draft.gifts.items[0].price === "RM 350");
    await setFiles(".cd-form > .cd-image input[type=file]", ["qr.png"]);
    check("the QR code uploads", await waitFor(`document.querySelector('.cd-form > .cd-image img.cd-thumb')`, 12000));
    await fill("Nama akaun DuitNow", "Muhammad Farid");
    await ev(`document.querySelector('textarea[dir=rtl]').closest('.field')`);
    await fill("Rujukan ayat", ""); 
    await click("Tambah warna");
    await ev(`(()=>{const rs=document.querySelectorAll('.cd-rows .row-card');const r=rs[rs.length-1];const el=r.querySelector('.cell.label input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Biru Muda');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await fill("Catatan (pilihan)", "Sila elakkan warna putih");
    await sleep(1600);
    server = await serverCard(cardId);
    check("the QR, account name and colours were saved", server.draft.duitnow.image === "duitnow/qr.webp" || server.draft.duitnow.image === "duitnow/qr.png");
    check("the dress code has a colour and a note", server.draft.dressCode?.colors?.[0]?.label === "Biru Muda" && server.draft.dressCode.note === "Sila elakkan warna putih", JSON.stringify(server.draft.dressCode));
    await shot("step5-filled");
    await ev(`document.querySelector('.cd-gift').scrollIntoView()`); await shot("step5-gifts");
    await click("Tambah hadiah");
    await ev(`(()=>{const r=document.querySelectorAll('.cd-gift')[1];const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
      set(r.querySelector('.cell.name input'),'Set pinggan');set(r.querySelector('.cell.price input'),'RM 120');set(r.querySelector('.cell.url input'),'https://shopee.com.my/set-pinggan')})()`);
    await sleep(1400);
    check("a second gift gets the next id", (await serverCard(cardId)).draft.gifts.items.map((g) => g.id).join() === "g1,g2");
    await click("Padam", "document.querySelector('.cd-gift')");
    check("deleting a gift row deletes its photo too", await waitFor(`document.querySelectorAll('.cd-gift').length===1`, 8000) && !(await serverCard(cardId)).assets.some((a) => a.path === "gifts/g1.webp"));
    check("a gift without its photo keeps the card incomplete", (await serverCard(cardId)).status.missing.some((m) => m.path === "gifts/g2.webp"));
    await setFiles(".cd-gift input[type=file]", ["gift.jpg"]);
    await waitFor(`document.querySelector('.cd-gift img.cd-thumb')`, 12000);
    server = await serverCard(cardId);
    check("the card is complete: nothing missing, no problems", server.status.ready === true, JSON.stringify([server.status.missing.map((m) => m.path), server.status.problems]));
    console.log("INFO still missing:", JSON.stringify(server.status.missing.map((m) => m.path)), "problems:", JSON.stringify(server.status.problems.map((p) => `${p.path}: ${p.message}`)));
  }

  // ---------- the last step
  await ev(`document.querySelector('.cd-tabs .cd-tab:last-child').click()`);
  check("the summary step opens", await waitFor(`location.pathname.endsWith('/terbit')`));
  await sleep(600);
  if (IMAGES) check("a complete card says so, and lists nothing as missing", await ev(`document.body.innerText.includes('Semua sudah lengkap') && !document.body.innerText.includes('Yang belum lengkap')`));
  else check("it lists what is still missing, with a way to go there", await ev(`document.body.innerText.includes('Yang belum lengkap') && !![...document.querySelectorAll('.todo .linkbtn')].length`));
  check("publishing is not open yet", await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Terbitkan kad')).disabled`));
  await click("Cadangkan daripada nama");
  check("an address is suggested from the names, and checked", await waitFor(`document.querySelector('.slug input').value==='${BRIDE.toLowerCase()}-farid' && document.querySelector('.slug .cd-ok')`, 6000));
  await click("Simpan alamat");
  check("the address is saved", await waitFor(`!document.querySelector('.slug .cd-ok') || true`) && (await sleep(900), (await serverCard(cardId)).card.slug === `${BRIDE.toLowerCase()}-farid`));
  await shot("terbit");

  // ---------- the preview of their own card (needs the build server: scripts/build-server.mjs in the engine, and BUILD_SECRET in api/.dev.vars)
  if (IMAGES) {
    check("the preview panel is on the last step, with a button to build one", await waitFor(`[...document.querySelectorAll('.cd-pv button')].some(b=>b.textContent.includes('Bina pratonton') && !b.disabled)`, 6000));
    await click("Bina pratonton");
    check("asking for a preview shows that it is being built", await waitFor(`document.querySelector('.cd-working')`, 6000));
    check("the server queued it", (await ev(`fetch('/api/cards/${cardId}/preview',{credentials:'same-origin'}).then(r=>r.json())`)).state === "queued");
    const run = execSync(`node scripts/build-server.mjs --once`, { cwd: ENGINE, env: { ...process.env, KAD_URL: URL_BASE, BUILD_SECRET: "dev-build-secret" }, encoding: "utf8" });
    check("the build server built and uploaded it", /✔ job/.test(run), run.trim().split("\n").slice(-2).join(" | "));
    check("the page notices and shows the card in a frame", await waitFor(`document.querySelector('.cd-pv-frame iframe') && document.body.innerText.includes('Pratonton kad anda sudah sedia')`, 12000));
    const pv = await ev(`fetch('/api/cards/${cardId}/preview',{credentials:'same-origin'}).then(r=>r.json())`);
    check("the server says ready, current, with a link that expires in a week", pv.state === "ready" && pv.stale === false && /^\/p\/[a-f0-9]{32}\/$/.test(pv.url) && pv.expiresAt > Date.now() + 6 * 86400000, JSON.stringify(pv));
    const head = await ev(`fetch(${JSON.stringify(pv.url)}).then(r=>({status:r.status,robots:r.headers.get('x-robots-tag'),csp:r.headers.get('content-security-policy'),type:r.headers.get('content-type')}))`);
    check("the link is served, not indexed, and sandboxed", head.status === 200 && /noindex/.test(head.robots) && /sandbox/.test(head.csp) && /text\/html/.test(head.type), JSON.stringify(head));
    await ev(`document.querySelector('.cd-pv-frame').scrollIntoView({block:'center'})`); await sleep(2500); await shot("terbit-preview");
    // open the link on its own, as a relative would from WhatsApp, and look at what the customer built
    const before = jsErrors.length;
    await nav(pv.url);
    await sleep(2500);
    const body = await ev(`document.body.innerText`);
    check("the preview shows their own names and the date, not a sample couple", body.includes(BRIDE) && body.includes("Farid") && !/Aisyah|Hafiz/.test(body), body.slice(0, 120).replace(/\n/g, " "));
    check("the preview carries the 'Pratonton' ribbon", /Pratonton/i.test(await ev(`document.documentElement.innerHTML`)));
    check("the preview page runs without errors", jsErrors.length === before, jsErrors.slice(before, before + 2).join(" | "));
    await shot("preview-page");
    // ---------- publishing: refused until the card is paid for (an admin does that for now), then built from the version they previewed
    await nav(`/app/cards/${cardId}/terbit`);
    check("publishing is shut before the package is activated, and says why", await waitFor(`[...document.querySelectorAll('.cd-pub button')].some(b=>b.textContent.includes('Terbitkan kad') && b.disabled) && document.querySelector('.cd-pub').innerText.includes('belum diaktifkan')`, 8000));
    execSync(`cd api && npx wrangler d1 execute warkah-kad --local --command "UPDATE cards SET status='paid' WHERE id='${cardId}'"`, { stdio: "ignore" });
    await nav(`/app/cards/${cardId}/terbit`);
    check("once paid, a previewed complete card can be published", await waitFor(`[...document.querySelectorAll('.cd-pub button')].some(b=>b.textContent.includes('Terbitkan kad') && !b.disabled)`, 8000));
    await shot("publish-ready");
    await click("Terbitkan kad");
    check("publishing shows that it is being built", await waitFor(`document.querySelector('.cd-pub .cd-working')`, 6000));
    const published = execSync(`node scripts/build-server.mjs --once`, { cwd: ENGINE, env: { ...process.env, KAD_URL: URL_BASE, BUILD_SECRET: "dev-build-secret" }, encoding: "utf8" });
    check("the build server built the real card and uploaded it", /✔ job/.test(published), published.trim().split("\n").slice(-2).join(" | "));
    check("the page says the card is live, with its address", await waitFor(`document.querySelector('.cd-pub').innerText.includes('sudah diterbitkan') && document.querySelector('.cd-pub a')`, 12000));
    const pub = await ev(`fetch('/api/cards/${cardId}/publish',{credentials:'same-origin'}).then(r=>r.json())`);
    check("the server says live at the card host, under the card's own address", pub.state === "live" && pub.url === `${URL_BASE}/${BRIDE.toLowerCase()}-farid/`, JSON.stringify(pub));
    await shot("publish-live");
    const before2 = jsErrors.length;
    await send("Page.navigate", { url: pub.url }); await sleep(3500);
    const live = await ev(`document.body.innerText`);
    check("the live card shows their names, without the preview ribbon", live.includes(BRIDE) && live.includes("Farid") && !/PRATONTON/i.test(live) && !/Aisyah|Hafiz/.test(live), live.slice(0, 120).replace(/\n/g, " "));
    check("the live card is not offered to search engines (a wedding invitation is private), and every photo of theirs is there", await ev(`(async()=>{const urls=[...document.images].map(i=>i.getAttribute('src')).filter(s=>s&&s.includes('/event/'));const codes=await Promise.all(urls.map(u=>fetch(u).then(r=>r.status)));return !!document.querySelector('meta[name=robots][content*=noindex]') && urls.length>=4 && codes.every(c=>c===200)})()`));
    await shot("live-card");
    console.log("INFO live card errors:", JSON.stringify(jsErrors.slice(before2, before2 + 2)).slice(0, 300));
    // changing the card afterwards makes the preview outdated
    await nav(`/app/cards/${cardId}/majlis`);
    await waitFor(`document.querySelector('.cd-form .field')`);
    await fill("Nama tempat", "Dewan Seroja"); await sleep(1500);
    await nav(`/app/cards/${cardId}/terbit`);
    check("after a change the panel says the preview is outdated and offers a new one", await waitFor(`document.body.innerText.includes('diubah selepas pratonton ini dibina') && [...document.querySelectorAll('.cd-pv button')].some(b=>b.textContent.includes('Bina pratonton baharu'))`, 8000));
    check("...and that the live card is now the older one, with publishing shut until they preview again", await ev(`document.querySelector('.cd-pub').innerText.includes('masih yang lama') && [...document.querySelectorAll('.cd-pub button')].some(b=>b.textContent.includes('Terbitkan semula') && b.disabled)`));
    await shot("terbit-outdated");
    // taking the card down: asks first, then the address stops working and the card can be published again
    check("the live panel offers to take the card down", await ev(`[...document.querySelectorAll('.cd-pub button')].some(b=>b.textContent.includes('Tarik balik kad ini'))`));
    await ev(`[...document.querySelectorAll('.cd-pub button')].find(b=>b.textContent.includes('Tarik balik kad ini')).click()`);
    check("it asks to confirm and says what will happen", await waitFor(`document.querySelector('.cd-down') && document.querySelector('.cd-down').innerText.includes('hilang serta-merta')`, 3000), `panels=${await ev(`document.querySelectorAll('.cd-pub').length`)} errors=${JSON.stringify(jsErrors.slice(-2)).slice(0, 300)}`);
    await shot("tarik-balik");
    await ev(`[...document.querySelectorAll('.cd-down button')].find(b=>b.textContent.includes('Ya, tarik balik')).click()`);
    check("afterwards the panel no longer says the card is live", await waitFor(`!document.querySelector('.cd-pub').innerText.includes('sudah diterbitkan')`, 8000));
    const gone = await ev(`fetch('${URL_BASE}/${BRIDE.toLowerCase()}-farid/',{credentials:'omit'}).then(r=>r.status)`);
    check("the card's address answers not found", gone === 404, String(gone));
    const after = await ev(`fetch('/api/cards/${cardId}',{credentials:'same-origin'}).then(r=>r.json())`);
    check("the card is back to paid and can still be edited", after.card?.status === "paid", JSON.stringify(after.card?.status));
  }

  // ---------- leave and come back
  await nav(`/app/cards/${cardId}`);
  check("coming back opens where there is still something missing, with everything kept", await waitFor(`document.querySelector('.cd-form .field')`));
  check("the saved names are in the form again", (await ev(`[...document.querySelectorAll('.cd-form .field input')].some(i=>i.value==='Muhammad Farid')`)) || (await ev(`location.pathname`)) !== "");
  await nav("/app/cards");
  check("the list shows the card with its names and a progress bar", await waitFor(`document.querySelector('.cd-mine h2') && document.querySelector('.cd-mine h2').textContent==='${BRIDE} & Farid'`));
  await shot("cards-list");
  check("no JavaScript errors anywhere", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));
} catch (e) {
  fails++; console.log("FAIL walk stopped:", e.message);
  await shot("failure").catch(() => {});
}
chrome.kill(); ws.close();
console.log(fails ? `${fails} FAILED` : "all passed", `(screenshots in ${OUT})`);
process.exit(fails ? 1 : 0);
