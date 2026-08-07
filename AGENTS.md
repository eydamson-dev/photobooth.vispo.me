# AGENTS.md

## What this is

Self-hosted photobooth for events (CJCRSG church). OBS captures snapshots via hotkey → Express server hosts a gallery, per-photo view pages with QR codes, and ZIP download.

Two independent components:

- **`server.js`** — the entire backend: a single-file Express app (CommonJS). All API routes, HTML view templates, and settings persistence live here.
- **`photobooth_uploader.py`** — an OBS Studio script. It imports `obspython`, which only exists inside OBS's embedded Python. It cannot be run or tested standalone; validate changes by reading, not executing.
- **`public/*.html`** — three static pages (`gallery`, `upload`, `settings`) with inline vanilla JS calling the API. No framework, no build step.

## Commands

- `npm start` — run the server (port 3000 by default)
- `npm run dev` — same with nodemon auto-reload
- There are **no tests, no lint, no typecheck, no CI**. Verify changes manually: start the server and exercise the endpoint (e.g. `curl -F "photo=@x.png" localhost:3000/api/upload`, then check `/api/photos`).

## Hard constraints

- **Node >= 22.12 is mandatory** (`.nvmrc` pins 24). `archiver@8` is ESM-only and `server.js` loads it via `require('archiver')` — this only works on Node >= 22.12 (require-of-ESM). Don't downgrade the floor or "fix" the require.
- archiver v8 API: use the named export `new ZipArchive(...)` as in `server.js`. The classic `archiver('zip')` factory from older tutorials no longer exists.
- **Upload field names differ by endpoint**: `/api/upload` expects multipart field `photo` (single, used by the OBS script); `/api/upload/batch` expects field `photos` (array, max 100). Both reject non-images and cap 25 MB/file.

## Runtime state (gitignored, auto-created on boot — never commit)

- `public/uploads/` — photos (volume-mounted in production)
- `public/assets/` — uploaded logo
- `data/settings.json` — org name/branding settings

## Environment

- `PORT` — default 3000
- `PUBLIC_DOMAIN` — **must be set in production.** QR codes and `/v/:filename` links are built from it; if unset they point at `localhost` and phones can't scan them. Production domain: `https://photobooth.cjcrsg.com`.
