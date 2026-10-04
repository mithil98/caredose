# CareDose: Smart Medicine Management & Caretaker Monitoring

A caretaker web app (PWA) that manages patients, medicines and dose schedules, tracks every dose through a
backend state machine, and alerts the caretaker by **Web Push even when the app is closed**. The physical
dispenser (Arduino UNO + DS3231 + SIM800L) doesn't exist yet, so a **device simulator** (a web page and a CLI) sends events over
**the same HTTP contract the hardware will use**.

## At a glance

- **For:** family members and carers who look after someone on a daily medicine routine.
- **What it does:** plan morning / afternoon / night doses, see today's doses live (taken, due, missed),
  get phone or desktop alerts when a dose is missed or the dispenser goes offline, and review adherence history.
- **Stack:** FastAPI, PostgreSQL, SQLAlchemy + Alembic, WebSockets, Web Push (VAPID) · React, TypeScript,
  Vite, Tailwind CSS, TanStack Query, GSAP, Three.js (installable PWA).
- **Hardware:** an Arduino UNO + SIM800L dispenser is planned. Until then the built-in simulator plays the device.
- **Status:** software MVP complete and tested (pytest, Vitest, Playwright end-to-end including real push delivery).
- **Quick start:** `pip install cryptography && python backend/scripts/gen_env.py` → `docker compose --profile app up --build` →
  open http://127.0.0.1:8080 (full setup below).

> CareDose records medication information entered by caretakers. It does not give medical advice, and the
> seed data is fictional.

```
Device simulator / future dispenser ──X-Device-Key──> FastAPI ──> PostgreSQL
                                                         │
                                  ┌──────────────────────┴───────────────────┐
                                  ▼                                          ▼
                       WebSocket (open dashboards)          Web Push / VAPID (app closed)
```

## What is implemented

| Area | Details |
|---|---|
| Auth & roles | Register/login, Argon2 password hashes, short-lived JWT access token + HttpOnly refresh cookie, `admin` / `caretaker` roles, per-request active check, rate-limited auth endpoints |
| Authorization | Caretakers only see their own patients/devices/doses/events (404 for anything else); admins see everything |
| Patients, medicines, schedules | Full CRUD. Schedules have time, morning/afternoon/evening/night, days of week, start/end date, active flag. Times are interpreted in the **patient's timezone** |
| Dose engine | Schedules → daily `medicine_doses` → `SCHEDULED → DUE → DISPENSED → TAKEN` or `→ MISSED` (configurable timeout), late flag, caretaker confirm/cancel. Runs in the backend every 30 s, guarded by a Postgres advisory lock + unique keys, so it never double-notifies |
| Devices | Registration with a one-time device key (HMAC-hashed), key rotation, heartbeat, online / late check-in / offline / error / never-connected status with configurable thresholds, offline + restored alerts |
| Device events | `POST /device-events` with `event_id` idempotency (SIM800L retries are stored once), clock-skew checks, dose matching by `dose_id`, `schedule_id`, slot or nearest open dose. The `patient_id` a device sends is never trusted |
| Real time | WebSocket (token sent in first message), reconnect with backoff, "Live / Reconnecting / Offline" indicator, stale-data banner |
| Web Push | Service worker, permission flow, subscription save/renew/remove, VAPID, provider interface (`PushProvider`) so FCM can be added later, per-category preferences, test notification, real delivery results (no faked success), notification click → patient + dose |
| Notification center | Unread count, mark read / all read, deep links |
| History & analytics | Filterable, paginated dose history + raw event log, CSV export, daily/weekly/monthly adherence (`taken / doses due so far × 100`, labelled as non-clinical) |
| Admin | System health, caretaker accounts, engine thresholds, audit log |
| PWA | Manifest, icons, installable, offline app shell only (API data is never cached) |

## Design system and motion

- **Identity:** Color Hunt palette `#F9F7F7` warm white, `#DBE2EF` mist, `#3F72AF` harbor blue, `#112D4E`
  deep navy (https://colorhunt.co/palette/f9f7f7dbe2ef3f72af112d4e). Navy "stage" areas hold the immersive
  moments (sign-in, welcome loader, dashboard hero, sidebar); harbor blue is the action colour. Status colours
  are reserved (green taken/online, amber pending, red missed/offline, violet info) and always come with an
  icon and a label. Tokens live in `src/index.css`.
- **DESIGN.md still drives** the font (Zalando Sans), heading sizes, the 5px/20px radii and the motion curves.
  `frontend/design-tokens.ts` parses it into `--ds-*` variables (live reload on edit), and `src/lib/motion.ts`
  turns its cubic-bezier curves into GSAP eases so CSS and GSAP motion match.
- **GSAP** (`gsap`, `@gsap/react`): SplitText headline reveals, ScrollTrigger batch reveals and scroll
  parallax, pointer parallax (`quickTo`), the progress ring and number count-ups, and the welcome loader
  timeline. All hooks run only under `prefers-reduced-motion: no-preference`.
- **Three.js:** `src/components/three/CapsuleScene.tsx` renders glossy two-tone capsules and a particle
  field (sign-in stage, loader orbit, dashboard hero). It is lazy-loaded (separate chunk), skipped when WebGL
  is missing, pauses off-screen or in hidden tabs, renders one still frame under reduced motion, and
  disposes GPU resources on unmount.
- **Welcome loader:** after sign-in or registration, a ~6 s full-screen sequence prefetches the dashboard and
  alert data, eases a progress ring and four step indicators while the status line cross-fades, then
  dissolves (fade, blur, slight scale) into the dashboard. "Skip" ends it early; reduced motion skips it.

## Project structure

```
backend/
  app/
    main.py              FastAPI app, CORS, lifespan (scheduler + WebSocket hub)
    config.py            settings from environment / .env
    models.py            SQLAlchemy models (10 required tables + system_config, medicine_doses)
    schemas.py           Pydantic request/response contract
    deps.py              auth, roles, device auth, rate limits
    api/v1/              routers: auth, patients, medicines, schedules, devices, events, doses,
                         notifications, analytics (dashboard), admin, ws
    services/            business logic: doses (state machine), devices, notifications, push,
                         realtime (hub + post-commit outbox), analytics, auth, system (scoping, audit)
    workers/scheduler.py engine tick
    seed.py              demo data
  alembic/               migrations
  scripts/simulate.py    CLI device simulator
  scripts/gen_env.py     creates .env with random secrets + VAPID keys
  tests/                 pytest (real PostgreSQL)
frontend/
  src/
    pages/               Dashboard, Patients, PatientDetail, Medicines, Schedules, Devices,
                         DeviceDetail, History, Notifications, Settings, Simulator, admin/*
    components/          design system (ui.tsx), shell, timeline, charts, forms, status badges
    lib/                 api client, auth, realtime, push, formatting, queries
    workers/service-worker.ts
    test/                Vitest + Testing Library
  e2e/                   Playwright end-to-end (demo flow with real Web Push)
docker-compose.yml       Postgres (+ app profile: backend + nginx frontend)
```

## Run locally (development)

Requirements: Docker, Python 3.11+, Node 20+.

```bash
# 1. secrets + VAPID keys -> .env (never commit it)
python -m venv backend/.venv && backend/.venv/Scripts/pip install -r backend/requirements-dev.txt   # Windows path; use bin/ on macOS/Linux
backend/.venv/Scripts/python backend/scripts/gen_env.py

# 2. database (also creates the caretaker_test database for pytest)
docker compose up -d db

# 3. backend
cd backend
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m app.seed --password demo-pass-2026 --history 21   # optional demo data
.venv/Scripts/uvicorn app.main:app --host 127.0.0.1 --port 8000

# 4. frontend (new terminal)
cd frontend && npm install && npm run dev        # http://127.0.0.1:5173
```

The seed prints the demo logins (`caretaker@example.com`, `admin@example.com`) and the `X-Device-Key` for
`MED-001`. API docs: http://127.0.0.1:8000/api/docs.

### Run everything in Docker

```bash
docker compose --profile app up --build     # http://127.0.0.1:8080
# optional: VITE_ENABLE_SIMULATOR=true docker compose --profile app up --build
docker compose --profile app exec backend python -m app.seed --password demo-pass-2026
```

The backend container runs `alembic upgrade head` on start. nginx serves the SPA and proxies `/api` and the
WebSocket, so the app is same-origin (refresh cookie, no CORS).

## Environment variables

See `.env.example`. Main ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `TEST_DATABASE_URL` | PostgreSQL (psycopg) URLs |
| `POSTGRES_PASSWORD` (+ `_USER`, `_DB`) | used by the db container |
| `JWT_SECRET`, `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | auth tokens |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push. The private key never leaves the server |
| `PUSH_ENDPOINT_HOSTS` | push services the server may send to (SSRF guard) |
| `DEVICE_API_SECRET` | HMAC key for hashing device keys |
| `CORS_ORIGINS` | allowed browser origins (comma-separated) |
| `ENVIRONMENT` | `production` enables `Secure` cookies and blocks the demo seed |
| `MISSED_DOSE_TIMEOUT_MINUTES`, `LATE_DOSE_AFTER_MINUTES`, `DEVICE_WARNING_AFTER_MINUTES`, `DEVICE_OFFLINE_AFTER_MINUTES` | initial engine thresholds (admins change them at `/admin`) |
| `SCHEDULER_INTERVAL_SECONDS` | engine tick |
| `VITE_ENABLE_SIMULATOR` | show `/dev/simulator` in production builds (always on in `npm run dev`) |

## Database

PostgreSQL 16, migrations in `backend/alembic/versions`. Apply with `alembic upgrade head`; create new ones
with `alembic revision --autogenerate -m "..."`. All timestamps are UTC (`timestamptz`); each patient has an
IANA timezone (default `Asia/Kolkata`) used to place schedule times.

## Device simulator

**Web** (`/dev/simulator`): pick a device, paste its key (or "New key"), pick a dose (or let the server
match), then use Medicine due / Dispense / Confirm taken / Report missed / Device heartbeat / online /
offline / error. "Resend last event" repeats the same `event_id` to show idempotency. Every request and
response is shown in the log.

**CLI** (useful when the web app should be closed, for push testing):

```bash
cd backend
.venv/Scripts/python scripts/simulate.py --key <device key> heartbeat
.venv/Scripts/python scripts/simulate.py --key <device key> due --slot night
.venv/Scripts/python scripts/simulate.py --key <device key> dispensed --schedule 3
.venv/Scripts/python scripts/simulate.py --key <device key> taken --retry 3   # stored once
.venv/Scripts/python scripts/simulate.py --key <device key> error --message "Servo 2 jammed"
.venv/Scripts/python scripts/simulate.py --help
```

Stopping heartbeats for longer than the offline threshold (default 15 min) triggers a "Device Offline" alert.
The next heartbeat sends "Device Online".

## Testing notifications (the core demo)

1. Sign in, add a patient, a medicine, an 8:00 PM schedule, and register `MED-001` (copy the key).
2. **Settings → Turn on alerts** (or the banner on the dashboard), then **Send test notification**.
3. Close every CareDose tab.
4. Run `scripts/simulate.py --key <key> dispensed` (or open the simulator in another browser/profile).
5. An OS notification "Medicine Dispensed" appears. Clicking it opens the patient page with that dose highlighted.

Notes: push needs HTTPS or `localhost`/`127.0.0.1`; the browser must allow notifications for the site; on
iOS the app must be added to the Home Screen first. Delivery result per notification (sent count or the
error, such as "disabled in notification preferences") is shown in the notification center.

## Tests

```bash
# backend (uses the caretaker_test database; migrations are applied by the suite)
cd backend && .venv/Scripts/python -m pytest

# frontend unit/component tests, typecheck, lint, build
cd frontend && npm test && npm run typecheck && npm run lint && npm run build

# end-to-end (backend on :8000 must be running; Vite starts automatically)
cd frontend && npx playwright install firefox && npm run test:e2e
```

The e2e demo-flow test registers a caretaker, creates patient / medicine / 8 PM schedule / device, enables
push, **closes the app**, sends device events over the hardware API, then checks the stored event, the
notification, the real push delivered through Mozilla's push service and shown by the service worker, and
the deep link. It runs in Firefox because automated Chrome/Edge profiles cannot register with FCM/WNS.
The `responsive` project in `playwright.config.ts` runs `e2e/responsive.spec.ts` in your local Chrome.
Both specs create throwaway accounts (`e2e-*@example.com`, `resp-*@example.com`) in the database the backend uses.

## Hardware integration contract

All device calls send `X-Device-Key: <key>` (no user token). Times are ISO-8601; UTC preferred.

| Call | Purpose |
|---|---|
| `GET /api/v1/devices/{device_id}/config` | patient timezone, active schedules (`schedule_id`, `HH:MM`, period, days, dose), heartbeat interval, missed timeout |
| `POST /api/v1/devices/{device_id}/heartbeat` | `{firmware_version, signal_strength (AT+CSQ), status: ok\|error, error}` updates last seen |
| `POST /api/v1/device-events` | `{event_id, device_id, event_type, schedule_id?, dose_id?, event_time?, metadata: {slot?, error?}}` |

`event_type`: `medicine_due`, `medicine_dispensed`, `medicine_taken`, `medicine_missed`, `device_online`,
`device_offline`, `device_error`. First delivery → `201`; a retry with the same `event_id` → `200` and
`"duplicate": true`. The response `result` is `applied`, `ignored` (e.g. already taken) or `unmatched`.

### What remains for the hardware phase

- Firmware: DS3231 schedule from `/config`, servo per slot, pickup sensor → `medicine_taken`, buttons/LCD/buzzer.
- SIM800L: HTTPS (`AT+HTTPSSL=1`; or a TLS-terminating gateway if the module's TLS is too old), custom
  header `X-Device-Key` via `AT+HTTPPARA="USERDATA"`, retry with the **same** `event_id`, persist unsent events.
- Store the device key in EEPROM; provisioning flow (QR / serial) instead of copy-paste.
- Optional: battery/power fields in heartbeat, remote config push, OTA firmware.

## Known limits (deliberate MVP choices)

- One backend process: WebSocket hub, rate limiter and scheduler are in-process (Redis / LISTEN-NOTIFY when scaling out).
- Doses are materialized for "today" each tick; if the server is down for a whole day, that day's doses are not created.
- Refresh tokens are stateless (logout clears the cookie; deactivating a user blocks it on the next request).
- Medication data is caretaker-entered; the app does not validate prescriptions or give medical advice.
