-- Warkah Kad (the invitation builder). Timestamps are milliseconds since epoch (INTEGER); ids are text (UUID).
-- draft_json holds ONLY what the customer typed or chose (no system fields, no sample content): see warkah-engine/docs/BUILDER-PHASE1-DESIGN.md.
-- tier and status are written only by billing / an admin / the publish job, never from a client request.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  phone       TEXT,
  role        TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE otp_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE email_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id),
  kind         TEXT NOT NULL,
  provider_id  TEXT,
  sent_at      INTEGER NOT NULL
);

-- Fixed-window counters used by sign-in and the builder's endpoints. Old windows are deleted by the daily cron.
CREATE TABLE rate_limits (
  key           TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- One row per card; a customer owns up to 3 drafts.
CREATE TABLE cards (
  id               TEXT PRIMARY KEY,
  owner_user_id    TEXT NOT NULL REFERENCES users(id),
  slug             TEXT NOT NULL UNIQUE,                         -- the card's address: <card domain>/<slug>/
  lang             TEXT NOT NULL DEFAULT 'ms' CHECK (lang IN ('ms', 'en')),
  tier             TEXT NOT NULL DEFAULT 'basic' CHECK (tier IN ('basic', 'full', 'custom')),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid', 'live', 'archived')),
  draft_json       TEXT NOT NULL DEFAULT '{}',
  draft_version    INTEGER NOT NULL DEFAULT 1,                   -- bumped on every save: optimistic locking
  kit_version      TEXT NOT NULL,                                -- the card-kit the draft was last written under
  preview_version  INTEGER,                                      -- the draft_version the latest preview was built from (the purchase gate)
  preview_token    TEXT UNIQUE,                                  -- unguessable; the preview lives at /p/<token>/ for 7 days
  preview_expires  INTEGER,
  preview_job      TEXT,                                         -- the job whose files are the current preview (previews/<token>/<job id>/ in R2)
  live_json        TEXT,                                         -- the last published event.json
  live_job         TEXT,                                         -- the job whose files are served at /<slug>/ (live/<slug>/<job id>/ in R2)
  live_version     INTEGER,                                      -- the draft_version that went live: "changed since publishing" while draft_version differs
  published_at     INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX cards_owner ON cards(owner_user_id);
CREATE INDEX cards_updated ON cards(status, updated_at);

CREATE TABLE card_assets (
  id            TEXT PRIMARY KEY,
  card_id       TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                                   -- a key of the kit's ASSET_RULES: cover, portrait, gallery, gift, qr, music
  path          TEXT NOT NULL,                                   -- where it will sit in the card: gallery/3.webp, portrait/groom.webp, duitnow/qr.png ...
  r2_key        TEXT NOT NULL,                                   -- cards/<card id>/<path>
  bytes         INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  content_type  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (card_id, path)
);
CREATE INDEX card_assets_card ON card_assets(card_id);

-- Build jobs. A preview or the real card is built by a separate build server, which asks for work (POST /api/build/claim), downloads the draft
-- and files, builds, uploads the result and says it is done.
CREATE TABLE card_jobs (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'preview' CHECK (kind IN ('preview', 'publish')),
  state          TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'building', 'ready', 'failed')),
  draft_version  INTEGER,                      -- preview: set when the build server claims the job. publish: the version the customer approved (their preview)
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     INTEGER NOT NULL,
  claimed_at     INTEGER,
  finished_at    INTEGER
);
CREATE INDEX card_jobs_queue ON card_jobs(state, created_at);
CREATE INDEX card_jobs_card ON card_jobs(card_id, created_at);
