# AGENTS.md

ShipCheck: a dark, terminal-inspired "deployment-readiness" analyzer. Frontend is a Next.js 14 App Router + React 18 + Tailwind single-page UI; there is also a real local backend (Next.js Route Handlers) for auth, feed data, scan execution, and persisted history. No external APIs/dependencies; everything (scanning, auth, storage) is implemented locally with Node built-ins.

## Commands

- `npm run dev` — start dev server (http://localhost:3000)
- `npm run lint` — ESLint (`next lint`)
- `npm run build` — production build
- There is **no** `typecheck` script. Run `npx tsc --noEmit` to typecheck.
- **No `test` script** — so a scan's "Tests" check reports "not configured" until one is added.
- No CI workflows directory (`.github/`).

## CLI (`node bin/shipcheck.js` / global `shipcheck`)

The CLI is the primary entry point (see `bin/shipcheck.js`):

- `shipcheck server` — the **canonical way to start the server**. Generates/reuses a boot token, auto-runs `next build` if `.next/BUILD_ID` is missing, spawns `next start` (or `next dev` with `--dev`), and prints `Dashboard: http://<host>:<port>/?token=<bootToken>`. If a ShipCheck server already answers on the port and accepts our token, it reuses it instead of spawning a duplicate. Options: `--port N` (default 3140), `--host H` (default 127.0.0.1), `--dev`.
- `shipcheck init` — register the **current directory** as a project (writes `.shipcheck.json`). Optionally `--deploy-url URL` to set the deployed application URL (enables Phase 3 post-deployment/API/perf checks).
- `shipcheck scan` — real scan of the **current directory** against the server (slow; runs build/tests).
- Commands run in the current directory; for monorepos run `init`/`scan` once per package root.
- The CLI talks to `http://localhost:3140` by default; override with `SHIPCHECK_SERVER_URL`.
- Auth: the CLI authenticates using the boot token from `SHIPCHECK_BOOT_TOKEN` or `~/.shipcheckrc` (sent as `x-shipcheck-token`), else a persisted session cookie, else `SHIPCHECK_PASSWORD` login.
- A server started by the CLI (or with `SHIPCHECK_BOOT_TOKEN` set) publishes the token to `~/.shipcheckrc` via `next.config.mjs`, so the CLI can discover it no matter how the server was started.

## Backend architecture

Route Handlers under `src/app/api/`, shared logic in `src/lib/`. All server-side, no external services:

- `src/lib/types.ts` — shared domain types (Issue, CategoryResult, ScanResult, FeedData, …).
- `src/lib/data.ts` — static feed reference (`FEED_DATA`: categories, stages, thresholds).
- `src/lib/checks.ts` — the real scan engine (`runScan`). Runs node/npm versions, `git status`/branch, `npm audit`, `npm run build`, `npm test`, docker presence, and a **local regex** secret scan + `.env.example` coverage. Persists each result via the store. The temp build/test workspace is a **full-tree copy** of the target (excluding `node_modules`, `.next`, `.git`, `.data`, `dist`, `build`, `.env*`; `node_modules` is reused via a Windows junction), so nested `src/` layouts (e.g. `app/`, monorepo sub-packages) work. Scoring is per-category **weighted** (`categoryWeights` in `data.ts`, single source of truth for weights and the 80/60 `thresholds`): a category with only warnings keeps half its weight, a critical category contributes 0. Build/tests with no `npm run <script>` configured are warnings ("No build script configured"), **not** criticals. `.env.example` checks make no assumptions about required variable names; the secret scan walks the whole tree (never `node_modules`/`.next`/`.env*`). **16 categories total** (weights sum to 100 in `data.ts`).

  **Phase 1 checks** (implemented): Git (branch, working-tree, `.gitignore` presence + critical entries), Database (detects Prisma/Drizzle/Knex/Supabase + raw pg/mysql/mongo drivers from config files or `package.json` deps; checks for a migration directory), CI/CD (detects GitHub Actions, GitLab CI, Jenkins, CircleCI, Bitbucket, Travis, Azure; validates YAML indentation + non-empty), Rollback (git version tags + optional rollback config), Security (secret scan + `.env.example` + **console.log/debugger detection**).

  **Planned (not yet implemented)**: Code Quality (ESLint via project's own config, Phase 2), Deployment (Vercel/Netlify/Fly/etc. config validation, Phase 2), Monitoring (Sentry/error-boundary detection, Phase 2), API Check (HTTP probing, Phase 3), Performance (Lighthouse + bundle size, Phase 3), Post-Deployment (smoke test, Phase 3 — only runs when `deployUrl` is set). These render as pass-status placeholder checks until implemented. `runScan(targetDir, projectId?, options?)` accepts `options.deployUrl` (from the Project record or scan body) for Phase 3 checks.
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
