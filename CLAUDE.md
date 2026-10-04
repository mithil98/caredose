# CareDose – project memory for Claude Code

Smart Medicine Management & Caretaker Monitoring System, built from `SMART_MEDICINE_PRD.md`.
Software-first MVP: the Arduino UNO + DS3231 + SIM800L dispenser does not exist yet; a device
simulator (web page + CLI) speaks the same HTTP contract the hardware will use.

- GitHub: https://github.com/mithil98/caredose (public, branch `main`)
- Commits use repo-local identity `mithil98 <mithilp059@gmail.com>` (the machine's global git
  identity belongs to someone else; do not change the global config). End commit messages with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `.env` is gitignored and holds real local secrets. Never commit it or print its values. Before every
  push, scan staged files for the `.env` secret values and for `dk_...` device keys.

## Status (as of 2026-10-04)

Done and verified:
- Full backend + frontend per PRD, all 14 PRD acceptance areas.
- Tests: backend 70 pytest, frontend 36 Vitest, 6 Playwright e2e (all green).
- PRD demo flow proven end to end in a real browser with real Web Push (Firefox, Mozilla push service).
- Docker production stack (`docker compose --profile app up --build` -> http://127.0.0.1:8080).
- Pushed to GitHub (3 commits). Vercel config committed (`vercel.json`).

Not done / pending:
- **Vercel deployment not created yet.** The user must import the repo at vercel.com/new, add a Neon
  Postgres DB (Storage tab) and env vars, then redeploy. Steps are in README "Deploy to Vercel".
  First deploy fails until `DATABASE_URL` + secrets exist (backend build runs `alembic upgrade head`).
- Unanswered questions to the user about Vercel: service names (`backend`/`frontend`), whether
  `/api/docs` should be public in prod, migrations on preview deploys (separate Neon branch?),
  Vercel plan (per-minute cron needs Pro; Hobby = daily), accept best-effort WebSockets or add
  Postgres LISTEN/NOTIFY fan-out.
- `vercel dev -L` locally: services detected, backend boots on Python 3.12, but the frontend service
  stalled at "Synchronizing dependencies" on this Windows machine, so routing was not verified locally.
- No LICENSE file (user was asked; no answer).
- Hardware integration (firmware, SIM800L) is future work; contract documented in README.

## Stack and layout

```
backend/   FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16, PyJWT, argon2, pywebpush (Python 3.12)
  app/main.py            app, CORS, security headers, lifespan (scheduler loop + WS hub), /api/v1 router,
                         /api/v1/health, /api/v1/internal/engine/tick (Vercel Cron, CRON_SECRET)
  app/config.py          pydantic-settings; reads ../.env; normalises postgres:// -> postgresql+psycopg://
  app/models.py          users, patients, devices, medicines, medicine_schedules, medicine_doses,
                         medicine_events (append-only log), push_subscriptions, notification_preferences,
                         notifications, audit_logs, system_config (single row)
  app/schemas.py         Pydantic API contract (+ `build()` helper)
  app/deps.py            current_user, require_admin, device auth (X-Device-Key), in-memory RateLimit
  app/api/v1/*.py        auth, patients, medicines, schedules, devices (+device-facing heartbeat/config),
                         events (POST /device-events, GET log), doses (history, CSV, PATCH), notifications
                         (+push subscribe/renew/test, preferences), analytics (+/dashboard), admin, ws
  app/services/          doses (state machine), devices, notifications, push (PushProvider interface),
                         realtime (WS hub + post-commit outbox), analytics, auth, system (scoping, audit)
  app/workers/scheduler.py  tick(): materialize doses, due/missed transitions, device offline; PG advisory lock
  app/seed.py            demo data (refuses in production)
  scripts/gen_env.py     creates ../.env with random secrets + VAPID keys
  scripts/simulate.py    CLI device simulator (CARETAKER_API, DEVICE_KEY env)
frontend/  React 19, TypeScript, Vite 8, Tailwind v4, TanStack Query, React Router 8, Phosphor icons,
           GSAP 3.15 (+@gsap/react, ScrollTrigger, SplitText, CustomEase), Three.js, vite-plugin-pwa
  design-tokens.ts       Vite plugin: parses ../DESIGN.md -> `virtual:design-tokens.css` (--ds-* vars:
                         font, heading sizes, radii, motion curves); falls back to defaults if missing
  src/index.css          colour tokens (Color Hunt palette #F9F7F7 #DBE2EF #3F72AF #112D4E), utilities
                         (bg-stage, bg-aqua, text-aqua, link, tabular), CSS motion, reduced-motion guard
  src/lib/motion.ts      GSAP registration, DESIGN.md eases, useSplitReveal / useBatchReveal / useParallax
  src/lib/               api (fetch + refresh), auth (welcome flag), realtime (WS + backoff), push, format
  src/components/        ui (design system), AppShell, WelcomeLoader (~6 s post sign-in), three/ (lazy
                         CapsuleScene + Scene3D WebGL guard), charts (AdherenceChart, ProgressRing), doses,
                         feeds, forms, history, ScheduleBoard, status, PushNudge
  src/pages/             Dashboard, Auth, Patients, PatientDetail, Medicines, Schedules, Devices,
                         DeviceDetail, History, Notifications, Settings, Simulator, admin/{System,Users,Audit}
  src/workers/service-worker.ts  precache shell, push display, notificationclick deep link, subscription renew
  e2e/                   demo-flow.spec.ts (Firefox, real push), responsive.spec.ts (local Chrome)
vercel.json  services: backend (/api/*), frontend (SPA); cron every minute; no bindings needed
docker-compose.yml  db (always), backend + frontend (nginx) under profile `app`
DESIGN.md  user-supplied extracted style file (font/radii/motion still used; palette no longer used)
```

## Key design decisions (keep them)

- Dose lifecycle is server-owned: schedules materialize into `medicine_doses` per patient-local day;
  `scheduled -> due -> dispensed -> taken`, `-> missed` after `missed_dose_timeout_minutes` from `due_at`,
  `missed -> taken` allowed (flagged late), caretaker can confirm/cancel. Doses created after a schedule
  edit skip times earlier than `schedule.updated_at`.
- Device events: unique `idempotency_key = "<device_uid>:<event_id>"`; retries return 200 + duplicate.
  `patient_id` from a device is never trusted. Dose matching: dose_id > schedule_id (get-or-create) >
  latest dispensed (for taken) > nearest open dose in window.
- Notifications deduped by `(user_id, dedupe_key)`; side effects (WS + push) run only after commit
  via the session outbox in `services/realtime.py`.
- Device auth: per-device key, HMAC-SHA256 with `DEVICE_API_SECRET`, shown once, rotatable.
- Push: VAPID, endpoint host allowlist `PUSH_ENDPOINT_HOSTS` (SSRF guard), 404/410 removes subscription,
  real delivery results stored; inline delivery when env `VERCEL` is set.
- Auth: short JWT access token in memory + HttpOnly refresh cookie on `/api/v1/auth`; WS authenticates
  with the token in its first message (code 4401 on failure).
- Single-process assumptions (ponytail-marked): WS hub, rate limiter, scheduler loop. Upgrade path:
  Postgres LISTEN/NOTIFY or Redis.
- Authorization: caretakers see only their patients/devices (404, not 403); admins see all.

## Running locally (Windows, Git Bash)

```bash
docker compose up -d db                                   # Postgres on 127.0.0.1:5432 (+ caretaker_test DB)
cd backend && .venv/Scripts/alembic upgrade head
.venv/Scripts/python -m app.seed --password demo-pass-2026 --history 21   # once; prints device key
.venv/Scripts/uvicorn app.main:app --host 127.0.0.1 --port 8000
cd frontend && npm run dev                                # http://127.0.0.1:5173 (proxies /api + WS)
```
Demo logins: `caretaker@example.com` / `admin@example.com`, password `demo-pass-2026` (dev only).
The MED-001 device key is printed by the seed and lives only in the DB (rotate from Device page or
simulator "New key").

## Tests and checks

```bash
cd backend && .venv/Scripts/python -m pytest          # uses TEST_DATABASE_URL (caretaker_test), runs migrations
.venv/Scripts/ruff check app tests scripts && .venv/Scripts/ruff format app tests scripts
cd frontend && npm test && npm run typecheck && npm run lint && npm run build
npx playwright install firefox && npm run test:e2e    # backend on :8000 must be running
```

## Environment gotchas learned this session

- Use `127.0.0.1`, not `localhost`, in DATABASE_URL (IPv6 hang on this machine).
- Python on Windows: set `PYTHONUTF8=1` for scripts that read files with non-ASCII text.
- Git Bash mangles leading `/` args for node scripts: prefix `MSYS_NO_PATHCONV=1`.
- `backend/.venv` is Python 3.12 (Vercel needs >=3.12; `vercel dev` reuses this venv). Docker image too.
- `backend/pyproject.toml` must keep `dependencies` (mirror of requirements.txt) and
  `[tool.setuptools.packages.find] include = ["app*"]`, or Vercel's `uv pip install backend/` fails.
- Uvicorn `--reload` did not pick up new routes reliably here; restart the server after backend edits.
- Claude-in-Chrome extension was not connected; browser checks used Playwright (local Chrome via
  `channel: 'chrome'`; Firefox build downloaded). Automated Chrome/Edge cannot get push subscriptions
  (no FCM/WNS), Playwright Firefox can.
- An orphaned Vite process may still hold port 5173 from earlier runs; check before starting another.
- Zalando Sans tabular figures render slashed zeros: the `tabular` utility uses lining-nums instead.
- `Intl.supportedValuesOf('timeZone')` returns `Asia/Calcutta`; use `tzOptions()` / `browserTimezone()`
  in `src/lib/format.ts` so saved `Asia/Kolkata` values are not overwritten.

## User preferences seen in this session

- Wants a polished, colourful, modern UI (asked to move away from black-and-white and from the
  "AI-looking" neon mint/cyan palette); current palette is the Color Hunt blue set above.
- Wants rich motion (GSAP, parallax, Three.js) and a ~6 s welcome loader after sign-in, while keeping
  data screens readable and respecting reduced motion.
- Global CLAUDE.md asks to use design skills (design-taste-frontend, web-design-guidelines) and to test
  at multiple viewports before finishing frontend work.
