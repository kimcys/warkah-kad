// Brings what the invitation builder shows from warkah-engine into public/ (git-ignored, regenerated on every dev and build):
//   public/builder/thumbnails/<theme>/*.webp   the theme chooser's photos          (engine: npm run thumbnails)
//   public/builder/models/<id>.webp            the groom and bride figures         (engine: models/)
//   public/preview/<theme>-<lang>/             the instant design previews         (engine: npm run previews)
// The engine repository is a sibling folder and stays private: only these generated files are copied, never its source.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const engine = process.env.WARKAH_ENGINE ? resolve(process.env.WARKAH_ENGINE) : resolve(root, "..", "warkah-engine");
if (!existsSync(engine)) { console.warn(`! builder assets skipped: ${engine} not found (set WARKAH_ENGINE)`); process.exit(0); }

const copy = (from, to, label, filter) => {
  if (!existsSync(from)) { console.warn(`! ${label}: ${from} not found (run the engine's script first)`); return; }
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, filter });
  console.log(`✔ ${label}`);
};
copy(join(engine, "samples", "thumbnails"), join(root, "public", "builder", "thumbnails"), "builder thumbnails");
copy(join(engine, "models"), join(root, "public", "builder", "models"), "builder models", (src) => !src.endsWith(".json") && !src.endsWith(".md"));
copy(join(engine, "previews"), join(root, "public", "preview"), `builder previews (${existsSync(join(engine, "previews")) ? readdirSync(join(engine, "previews")).filter((n) => !n.endsWith(".json")).length : 0} cards)`);
