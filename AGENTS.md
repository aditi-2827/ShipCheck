# AGENTS.md

ShipCheck: a dark, terminal-inspired "deployment-readiness" analyzer. Frontend is a Next.js 14 App Router + React 18 + Tailwind single-page UI; there is also a real local backend (Next.js Route Handlers) for auth, feed data, scan execution, and persisted history. No external APIs/dependencies; everything (scanning, auth, storage) is implemented locally with Node built-ins.

## Commands

- `npm run dev` — start dev server (http://localhost:3000)
- `npm run lint` — ESLint (`next lint`)
- `npm run build` — production build
- There is **no** `typecheck` script. Run `npx tsc --noEmit` to typecheck.
- **No `test` script** — so a scan's "Tests" check reports "not configured" until one is added.
- No CI workflows directory (`.github/`).

## Backend architecture

Route Handlers under `src/app/api/`, shared logic in `src/lib/`. All server-side, no external services:

- `src/lib/types.ts` — shared domain types (Issue, CategoryResult, ScanResult, FeedData, …).
- `src/lib/data.ts` — static feed reference (`FEED_DATA`: categories, stages, thresholds).
- `src/lib/checks.ts` — the real scan engine (`runScan`). Runs node/npm versions, `git status`/branch, `npm audit`, `npm run build`, `npm test`, docker presence, and a **local regex** secret scan + `.env.example` coverage. Persists each result via the store.
- `src/lib/store.ts` — file-based JSON persistence under `.data/` (gitignored): scan history, auth secret, sessions. Swappable for a real DB later.
- `src/lib/http.ts` — response envelope `{ ok:true, data } | { ok:false, error:{code,message,details?} }` and `ApiError`/`readJson`/`errorResponse` helpers.
- `src/lib/auth.ts` — local session-cookie auth: password from `SHIPCHECK_PASSWORD` env, stored only as an scrypt hash (Node `crypto`), random session token in HttpOnly `SameSite=Strict` cookie.

### API routes

| Route | Auth | Purpose |
|---|---|---|
| `GET  /api/feed` | none | Static reference data (categories, stages, thresholds) |
| `POST /api/auth/login` | — | Verify password, set session cookie |
| `POST /api/auth/logout` | — | Destroy session, clear cookie |
| `GET  /api/auth/me` | — | Report `{ authenticated }` |
| `POST /api/scan` | required | Run `runScan()` (real build + tests), persist, return result |
| `GET  /api/history` | required | Return past scan results (latest first, capped at 200) |

All API routes declare `export const dynamic = 'force-dynamic'` to avoid prerendering.

## Run requirements

- Scanning runs `npm run build` / `npm test` **synchronously server-side**, so `/api/scan` is slow (tens of seconds) and side-effecting. Timeouts exist per check.
- `SHIPCHECK_PASSWORD` must be set or login returns a 500 (`INTERNAL`). There is no default. Sessions expire after 12h.

## Windows gotchas (this repo is developed on Windows)

- **Command spawning:** in `checks.ts`, commands run via `exec` (shell) on Windows. `execFile` will fail on `npm`/`npx` because they are `.cmd` shims not resolved through PATH. Do not switch to `execFile` for npm commands on Windows.
- Child-process commands are hard-coded literals (no user input), so shelling out is safe.

## Frontend (`src/app/page.tsx`)

'single-page client view. The "RUN SHIPCHECK" button and the status/timeline data are still simulated client-side (`useState` + `setTimeout`, e.g. `runScan` around line 33) and are **not yet wired** to the `/api/*` backend. So flipping `page.tsx` to consume `runScan` results is a known unfinished integration, not a regression. Hand-written CSS in `src/app/globals.css` (not Tailwind utilities); semantic color tokens live in `tailwind.config.ts`.

## Gotchas

- `next.config.mjs` sets `optimizePackageImports: ['lucide-react']`, but `lucide-react` is **not** installed. Don't import it unless you add it to `package.json`.
- `reactStrictMode: true` is on — be aware effects run twice in dev.
- Never add external scanning/auth/AI dependencies; core functionality must stay local.
