# Warkah Kad

Customers build their own digital wedding invitation: choose a theme, palette and models, fill in the details, see a full preview of **their own** card, and publish it at `https://<card host>/<slug>/`.

This is a product of its own. It shares nothing with Warkah Kenang (the guest memory wall): separate repo, Worker, database, bucket, sign-in and domain.

## What is here

| Folder | What |
|---|---|
| `src/` | The site (Vite, plain JS): the landing page (`/`), sign-in and the builder (`/app/cards`). |
| `api/` | The Worker (Hono, D1, R2): sign-in, the card API, build jobs, preview and card serving, daily cleanup. |
| `scripts/` | `sync-builder-assets.mjs` (brings the theme pictures from the engine), `builder-walk.mjs` (a scripted walk in headless Chrome). |

## The engine is private

Cards are built from `warkah-engine`, which is **never shared with customers**. This repo only uses:

- the **card kit** (`file:../warkah-engine/kit`): form steps, rules, converters, sanitiser, catalogue. Rebuild it in the engine with `npm run kit`.
- generated pictures (theme thumbnails, models, instant previews), copied by `npm run sync:builder` into `public/builder` and `public/preview` (git-ignored).
- the **build server** (`npm run build-server` in the engine): a pull worker that asks this Worker for jobs (`POST /api/build/claim`), builds the preview or the real card, and uploads the files. It authenticates with `BUILD_SECRET`; set `KAD_URL` to this site's address.

## Develop

```
npm install && npm --prefix api install
cp api/.dev.vars.example api/.dev.vars
npm --prefix api run migrate:local
npm run build                  # the Worker serves ../dist
npm --prefix api run dev       # http://localhost:8787
npm --prefix api test          # API and front-end logic tests
```

`npm run dev` (Vite, port 5180) proxies `/api` to the Worker. In development the card host is `localhost` (`CARD_HOST` in `.dev.vars`), so a published card is at `http://localhost:8787/<slug>/`. `wrangler dev` runs with `--local-upstream` for that reason (otherwise it rewrites the host to the production route's).

Sign-in codes are printed in the Worker's log while `EMAIL_MODE=fake`.

Until payment is online, an admin activates a card: `npm --prefix api run make-admin -- you@example.com`, then `PATCH /api/admin/cards/:id {"paid": true, "tier": "full"}`.

## Settings

One place each, so moving to `kad.warkah.com.my` is a settings change:

- `PUBLIC_ORIGIN` and the route in `api/wrangler.toml`: the site.
- `CARD_HOST` in `api/wrangler.toml`: where published cards are served (may be the same host). Keep in step with `CARD_DOMAIN` in the engine (`src/lib/system-fields.js`).

## Not done yet

- Deploy: create the D1 database and R2 bucket, put their ids and names in `wrangler.toml`, add the route/DNS, set the `OTP_PEPPER`, `BUILD_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM` secrets, run the build server on a host (DigitalOcean) and send it `KAD_URL` and `BUILD_SECRET`.
- Online payment (an admin marks cards paid for now), the privacy notice and terms (sign-in does not link to them yet), English text, an admin screen (the API exists).
