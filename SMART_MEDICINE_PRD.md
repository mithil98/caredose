# PRD — Smart Medicine Management & Caretaker Monitoring System

**Document type:** Product Requirements Document  
**Version:** 1.0  
**Status:** Software-first MVP  
**Primary implementation target:** Claude Code  
**Hardware status:** Hardware integration will be implemented later

---

# 1. Product Overview

Build a web-based Smart Medicine Management System that allows a caretaker to remotely manage a patient's medicine schedule, monitor medicine events, and receive real-time push notifications even when the web application is closed.

The first development phase is **software only**. The application must work completely with simulated/device-test events so that the hardware can be connected later without redesigning the frontend or backend.

The future hardware device will be an automatic medicine dispenser based on Arduino UNO + DS3231 RTC + servo motors + SIM800L + sensors.

## Core concept

```text
Future Hardware Device
        |
        | Medicine event / device status
        v
     Backend API
        |
   +----+------------------+
   |                       |
   v                       v
Database              Notification Service
                           |
                           v
                    Caretaker's Device
                           |
                           v
                    Push Notification
```

The web application should therefore be treated as a **remote monitoring and management platform**, not as software that directly controls the physical Arduino in this first phase.

---

# 2. Problem Statement

Patients may forget scheduled medicines, while caretakers may not always be physically present.

The system should provide:

- Centralized medicine schedules
- Patient/device management
- Medicine event history
- Real-time dashboard updates
- Push notifications
- Missed-dose alerts
- Device connectivity monitoring
- A clean integration path for the future physical dispenser

The caretaker should be able to know what happened without keeping the web application open.

---

# 3. Product Goals

## Primary goals

1. Create a responsive caretaker web application.
2. Allow caretakers to create and manage patients.
3. Allow medicine schedules to be configured.
4. Store medicine and patient data securely.
5. Receive simulated medicine-device events through an API.
6. Show live events on the dashboard.
7. Send browser push notifications for important events.
8. Deliver push notifications even when the website tab/window is closed, subject to browser/OS notification permissions and connectivity.
9. Provide medicine history and adherence statistics.
10. Provide a clean REST API for future Arduino/SIM800L integration.
11. Keep hardware-specific logic outside the core business logic.

## Secondary goals

- PWA support
- Installable web app experience
- Device heartbeat monitoring
- Notification preferences
- Exportable medicine history
- Basic audit logging

---

# 4. Non-Goals for Version 1

Do NOT implement these in the first software phase:

- Direct Arduino firmware
- Servo motor control
- SIM800L firmware
- Physical medicine dispensing mechanism
- Medical diagnosis
- Medical recommendations
- Prescription generation
- AI diagnosis
- Automatic changes to prescribed medicine
- Payment system
- Doctor/patient telemedicine
- Native Android/iOS application

The backend must expose interfaces that make future hardware integration possible.

---

# 5. Recommended Technology Stack

Use a practical, maintainable stack.

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- TanStack Query for server-state management
- Recharts or another lightweight chart library
- PWA/service-worker support
- Browser Push API

## Backend

- Python
- FastAPI
- Pydantic
- SQLAlchemy
- PostgreSQL
- JWT-based authentication
- WebSocket support

## Notifications

Use standards-based Web Push where practical.

Preferred architecture:

```text
Backend
   |
   v
Web Push
   |
   v
Browser Push Service
   |
   v
Service Worker
   |
   v
OS Notification
```

Use VAPID keys for Web Push.

The notification system must be abstracted behind a service interface so another provider such as Firebase Cloud Messaging can be introduced later without changing application business logic.

## Development

- Docker / Docker Compose
- `.env` for secrets
- pytest for backend tests
- Vitest + React Testing Library for frontend tests
- ESLint
- Prettier

---

# 6. User Roles

## Caretaker

Primary user.

Can:

- Log in
- View dashboard
- Add/edit patients
- Add/edit medicines
- Create schedules
- View medicine history
- View device status
- Configure notification preferences
- Register browser/device for push notifications
- Receive alerts

## Admin

Optional for initial architecture.

Can:

- Manage caretakers
- Manage all patients/devices
- View system-level status
- View audit logs

If admin functionality increases implementation complexity, keep the backend role field ready but implement only the caretaker workflow in MVP.

---

# 7. Core User Flow

## 7.1 First-time caretaker setup

```text
Open Web App
     |
     v
Register / Login
     |
     v
Create Patient
     |
     v
Register Device
     |
     v
Add Medicines
     |
     v
Create Medicine Schedule
     |
     v
Enable Notifications
     |
     v
Dashboard
```

## 7.2 Medicine event flow

```text
Device / Simulator
       |
       v
POST /api/v1/device-events
       |
       v
Validate device
       |
       v
Store event
       |
       +------------------+
       |                  |
       v                  v
Update live state    Evaluate alert rules
       |                  |
       v                  v
WebSocket update     Push notification
       |                  |
       +--------+---------+
                |
                v
         Caretaker Dashboard
```

---

# 8. Dashboard Requirements

Create a modern responsive dashboard.

## Header

Show:

- Application name
- Current user
- Notification status
- Connection status
- Profile/logout

## Summary cards

Display:

- Total patients
- Today's scheduled doses
- Taken doses
- Pending doses
- Missed doses
- Online devices
- Offline devices

## Today's medicine schedule

Table/cards containing:

- Patient
- Medicine
- Dose
- Scheduled time
- Actual event time
- Status

Statuses:

- Scheduled
- Due
- Dispensed
- Taken
- Missed
- Late
- Cancelled

## Recent alerts

Show latest alerts:

- Medicine due
- Medicine dispensed
- Medicine taken
- Medicine missed
- Device offline
- Device back online
- Device error

## Live event indicator

When the backend sends a WebSocket event, update the dashboard without a manual refresh.

---

# 9. Patient Management

Create a patient list page.

Each patient should have:

- Patient ID
- Name
- Date of birth or age
- Optional contact information
- Assigned device
- Active/inactive status
- Medicine count
- Today's adherence

Patient details page:

```text
Patient
├── Overview
├── Medicines
├── Schedule
├── History
├── Adherence
└── Device
```

Do not collect unnecessary medical information in the MVP.

---

# 10. Medicine Management

Each medicine record should contain:

- Medicine name
- Optional generic name
- Dose quantity
- Unit
- Instructions/notes
- Active/inactive state

Example:

```text
Medicine:
Paracetamol

Dose:
1

Unit:
tablet

Instructions:
After food
```

The system must treat these as user-provided medication instructions. It must not generate or medically validate prescriptions.

---

# 11. Schedule Management

A schedule must support:

- Morning/afternoon/night labels
- Exact time
- Frequency
- Start date
- Optional end date
- Days of week
- Dose
- Active/inactive state

Example:

```text
Morning
08:00 AM
Every day
1 tablet
```

Future-ready structure should allow multiple doses per day.

---

# 12. Device Management

The software must support a generic device model.

Example:

```text
Device ID: MED-001
Patient: Rahul
Status: Online
Last heartbeat: 10 seconds ago
Firmware: 1.0.0
Signal: Unknown
```

Device states:

- Online
- Offline
- Warning
- Error
- Unregistered

The first version should include a **Device Simulator** so the complete system can be tested before hardware exists.

---

# 13. Device Simulator

Create a development-only simulator.

It should allow the developer to generate:

### Events

- `medicine_due`
- `medicine_dispensed`
- `medicine_taken`
- `medicine_missed`
- `device_online`
- `device_offline`
- `device_error`

Example:

```json
{
  "device_id": "MED-001",
  "patient_id": "PAT-001",
  "event_type": "medicine_dispensed",
  "medicine_id": "MEDICINE-001",
  "schedule_id": "SCHEDULE-001",
  "event_time": "2026-10-03T20:00:00Z",
  "metadata": {
    "slot": "night"
  }
}
```

The simulator can be a developer page or CLI tool.

It must use the same API that future hardware will use.

---

# 14. Hardware Integration Contract

Do not couple the backend to Arduino.

Define a generic device API.

Future hardware should eventually be able to perform:

```text
POST /api/v1/device-events
POST /api/v1/devices/{device_id}/heartbeat
GET  /api/v1/devices/{device_id}/config
```

The Arduino/SIM800L implementation will be added later.

The backend should not care whether an event originated from:

- Device simulator
- Arduino UNO
- ESP32
- Another IoT gateway

---

# 15. Real-Time Dashboard

Use WebSockets for events while the dashboard is open.

Example:

```text
Backend
   |
   | WebSocket
   v
React Dashboard
```

When a medicine event occurs:

```text
Medicine dispensed
        |
        +----> Database
        |
        +----> WebSocket ---> Dashboard updates
        |
        +----> Push -------> Caretaker notification
```

WebSocket is for **live UI updates**.

It is NOT the mechanism responsible for notifications when the website is closed.

---

# 16. Push Notification System

This is a critical requirement.

## Requirement

The caretaker must be able to receive important notifications even when the website tab/window is closed, assuming:

- Notification permission was granted
- Browser/OS supports Web Push
- Device has network connectivity
- Browser/OS notification settings allow it

## Frontend requirements

Implement:

1. Service worker
2. Notification permission request
3. Push subscription registration
4. Push subscription renewal/update handling
5. Push subscription removal
6. Notification click handling

The service worker must display notifications using the browser notification API.

## Backend requirements

Store push subscriptions securely.

Example conceptual data:

```json
{
  "user_id": "USER-001",
  "endpoint": "...",
  "expiration_time": null,
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

Do not expose VAPID private keys to the frontend.

---

# 17. Notification Rules

Implement the following initial rules.

## Medicine due

Trigger when a scheduled medicine becomes due.

Notification:

```text
💊 Medicine Due

Patient Rahul's morning medicine
is due now.

Medicine: Medicine A
Dose: 1 tablet
```

## Medicine dispensed

Trigger when device reports dispensing.

```text
💊 Medicine Dispensed

Patient Rahul's medicine was
dispensed at 08:02 AM.
```

## Medicine taken

Trigger when a future pickup sensor reports successful pickup.

```text
✅ Medicine Taken

Patient Rahul's morning dose
was confirmed at 08:04 AM.
```

## Medicine missed

Trigger when configured timeout expires without a `medicine_taken` confirmation.

```text
⚠️ Medicine Missed

Patient Rahul's morning dose
has not been confirmed.
```

## Device offline

If no heartbeat is received for the configured timeout:

```text
🔴 Device Offline

Medicine device MED-001 has not
communicated with the server.
```

## Device restored

```text
🟢 Device Online

Medicine device MED-001 is
connected again.
```

---

# 18. Notification Preferences

Caretaker should be able to enable/disable notification categories.

Example:

```text
Medicine Due          ON
Medicine Taken        ON
Medicine Missed       ON
Device Offline        ON
Device Restored       ON
```

Do not allow users to disable critical security/system notifications if the application later defines them as mandatory.

---

# 19. Medicine History

Create a history page.

Filters:

- Patient
- Medicine
- Date range
- Status
- Device

Example:

| Date | Medicine | Scheduled | Actual | Status |
|---|---|---:|---:|---|
| Oct 3 | Morning Medicine | 08:00 | 08:02 | Taken |
| Oct 3 | Afternoon Medicine | 13:00 | 13:07 | Taken |
| Oct 3 | Night Medicine | 20:00 | — | Missed |

Provide pagination.

---

# 20. Adherence Analytics

Calculate:

```text
Adherence % =
Confirmed Taken Doses / Scheduled Doses × 100
```

Show:

- Daily adherence
- Weekly adherence
- Monthly adherence
- Missed doses
- Late doses
- Total scheduled doses

Use charts only where they improve understanding.

Do not present adherence as a medical diagnosis or clinical assessment.

---

# 21. Authentication

Implement:

- Registration
- Login
- Logout
- Password hashing
- JWT access token
- Protected routes
- Role-based authorization

Never store plaintext passwords.

Use environment variables for secrets.

---

# 22. API Design

Use versioned APIs:

```text
/api/v1/
```

Suggested endpoints:

## Auth

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
GET  /auth/me
```

## Patients

```text
GET    /patients
POST   /patients
GET    /patients/{id}
PUT    /patients/{id}
DELETE /patients/{id}
```

## Medicines

```text
GET    /patients/{patient_id}/medicines
POST   /patients/{patient_id}/medicines
PUT    /medicines/{id}
DELETE /medicines/{id}
```

## Schedules

```text
GET    /patients/{patient_id}/schedules
POST   /patients/{patient_id}/schedules
PUT    /schedules/{id}
DELETE /schedules/{id}
```

## Devices

```text
GET    /devices
POST   /devices
GET    /devices/{id}
PUT    /devices/{id}
POST   /devices/{id}/heartbeat
```

## Device events

```text
POST /device-events
GET  /device-events
```

## Notifications

```text
GET  /notifications
POST /notifications/push-subscription
DELETE /notifications/push-subscription
PUT /notifications/preferences
```

## Analytics

```text
GET /analytics/patients/{patient_id}/adherence
```

---

# 23. Database Model

Use PostgreSQL.

Suggested entities:

```text
users
patients
devices
medicines
medicine_schedules
medicine_events
push_subscriptions
notification_preferences
notifications
audit_logs
```

Relationships:

```text
User
 |
 +---- Patients
          |
          +---- Medicines
          |
          +---- Schedules
          |
          +---- Device
          |
          +---- Medicine Events
```

A patient may have one primary device in MVP, but the database should not make the architecture impossible to extend to multiple devices later.

---

# 24. Security Requirements

Because this application stores patient-related information:

- Use HTTPS in production.
- Hash passwords with a strong password hashing algorithm.
- Never commit secrets.
- Use `.env`.
- Validate all API input.
- Authenticate device requests.
- Do not trust `patient_id` supplied by an unauthenticated client.
- Restrict caretaker access to authorized patients.
- Rate-limit authentication and device-event endpoints.
- Avoid logging sensitive patient information.
- Sanitize user-controlled text.
- Validate Web Push subscriptions.
- Never expose private VAPID keys.
- Use secure CORS configuration in production.

For device authentication, design for a per-device credential/token so future Arduino devices can authenticate without using a caretaker's user token.

---

# 25. Error Handling

The UI must clearly handle:

- Backend unavailable
- WebSocket disconnected
- Notification permission denied
- Push subscription failure
- Device offline
- Invalid device event
- Expired authentication
- Database errors

Example:

```text
Connection lost.
Trying to reconnect...
```

The dashboard must not silently display stale live data as if it were current.

---

# 26. UI/UX Requirements

Design should be:

- Clean
- Modern
- Professional
- Responsive
- Accessible
- Easy for a non-technical caretaker to understand

Avoid overly complicated dashboards.

Important information should be visually obvious:

```text
✓ Taken
⏳ Pending
⚠ Missed
🔴 Offline
🟢 Online
```

Do not rely only on colors; include text/icons for status.

Responsive layouts must support:

- Desktop
- Tablet
- Mobile

---

# 27. Pages

Implement these pages:

```text
/login
/register

/dashboard

/patients
/patients/:id

/medicines
/schedules

/devices
/devices/:id

/history
/notifications
/settings
```

Optional development page:

```text
/dev/simulator
```

The simulator page should only be enabled in development mode.

---

# 28. Frontend Component Structure

Suggested structure:

```text
src/
├── components/
│   ├── layout/
│   ├── dashboard/
│   ├── patients/
│   ├── medicines/
│   ├── schedules/
│   ├── devices/
│   ├── notifications/
│   └── common/
├── pages/
├── hooks/
├── services/
├── lib/
├── types/
├── stores/
└── workers/
    └── service-worker.ts
```

---

# 29. Backend Structure

Suggested structure:

```text
backend/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models/
│   ├── schemas/
│   ├── api/
│   │   └── v1/
│   ├── services/
│   │   ├── auth.py
│   │   ├── medicine.py
│   │   ├── device.py
│   │   ├── notification.py
│   │   ├── push.py
│   │   └── websocket.py
│   └── workers/
├── tests/
├── requirements.txt
└── Dockerfile
```

Keep business logic in services instead of putting everything into route handlers.

---

# 30. Scheduled Job System

The backend needs a scheduler for medicine due/missed events.

Do not depend on the browser being open.

The scheduler should:

1. Read active schedules.
2. Determine upcoming due doses.
3. Create due events.
4. Trigger notifications.
5. Track whether the dose was dispensed/taken.
6. Mark missed doses after the configured timeout.
7. Avoid duplicate notifications.

The scheduler must be safe against duplicate execution.

---

# 31. Timezone Requirements

Store timestamps consistently.

Recommended:

- Store database timestamps in UTC.
- Store each patient's/caretaker's timezone.
- Convert to local time in the UI.
- Medicine schedules must be interpreted in the patient's configured timezone.

Default timezone for initial development may be:

```text
Asia/Kolkata
```

but do not hard-code it into the data model.

---

# 32. Device Heartbeat

Future hardware should periodically send:

```text
POST /api/v1/devices/{device_id}/heartbeat
```

Example:

```json
{
  "device_id": "MED-001",
  "timestamp": "2026-10-03T15:30:00Z",
  "firmware_version": "1.0.0"
}
```

The backend records `last_seen`.

Example rule:

```text
last_seen < 5 minutes  → Online
5–15 minutes           → Warning
>15 minutes            → Offline
```

Make thresholds configurable.

---

# 33. Device Event Idempotency

Device events must not be duplicated if a cellular connection retries the same request.

Each event should have a unique:

```text
event_id
```

The backend must safely ignore/reconcile duplicate event submissions.

This is especially important for future SIM800L connectivity where network retries can occur.

---

# 34. Future Hardware Compatibility

The eventual Arduino system is expected to contain:

```text
Arduino UNO
DS3231 RTC
16x2 LCD
3 Servo Motors
SIM800L
4 Buttons
Buzzer
Alarm LED
Medicine pickup sensor
```

The software must not depend on the hardware pin configuration.

The hardware will communicate using the backend API contract.

Potential future flow:

```text
DS3231
   ↓
Arduino
   ↓
Medicine schedule
   ↓
Servo
   ↓
Pickup sensor
   ↓
SIM800L
   ↓
HTTPS API
   ↓
Backend
```

---

# 35. Development-First Device Simulator

Before hardware exists, the developer must be able to test the complete flow.

Example simulator actions:

```text
[Medicine Due]
[Dispense Morning]
[Confirm Taken]
[Report Missed]
[Device Heartbeat]
[Device Offline]
```

When clicking:

```text
[Dispense Morning]
```

the expected behavior is:

```text
API request
     ↓
Backend validates event
     ↓
Database stores event
     ↓
Dashboard updates
     ↓
Notification is generated
     ↓
Push notification is delivered
```

This should be demonstrable without any physical Arduino.

---

# 36. Testing Requirements

## Backend

Test:

- Authentication
- Authorization
- Patient CRUD
- Medicine CRUD
- Schedule CRUD
- Device registration
- Heartbeat
- Event ingestion
- Duplicate events
- Notification generation
- Missed-dose logic
- Adherence calculation

## Frontend

Test:

- Login
- Dashboard
- Patient creation
- Medicine creation
- Schedule creation
- Device status
- History
- Notification permission flow
- Push subscription registration
- WebSocket reconnect
- Mobile responsiveness

## End-to-end

At minimum test:

```text
Create patient
   ↓
Create medicine
   ↓
Create schedule
   ↓
Register device
   ↓
Simulate medicine event
   ↓
Backend receives event
   ↓
Dashboard updates
   ↓
Notification is generated
```

---

# 37. Environment Variables

Create `.env.example`.

Suggested variables:

```env
DATABASE_URL=
JWT_SECRET=
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=

CORS_ORIGINS=

DEVICE_API_SECRET=
```

Never put real secrets into source control.

---

# 38. Seed Data

Development mode should include optional seed data:

### Caretaker

```text
Name: Demo Caretaker
Email: caretaker@example.com
```

### Patient

```text
Name: Demo Patient
Device: MED-001
```

### Medicines

```text
Morning Medicine
Afternoon Medicine
Night Medicine
```

### Schedules

```text
08:00
13:00
20:00
```

Do not use real patient data.

---

# 39. Acceptance Criteria

The MVP is complete when all of the following work:

### Authentication

- [ ] User can register.
- [ ] User can log in.
- [ ] Protected routes reject unauthorized access.

### Patient

- [ ] User can create a patient.
- [ ] User can edit a patient.
- [ ] User can view patient details.

### Medicine

- [ ] User can create medicine records.
- [ ] User can edit/delete medicines.
- [ ] User can assign medicines to patients.

### Schedule

- [ ] User can create schedules.
- [ ] User can view today's schedule.
- [ ] Schedule times are timezone-aware.

### Device

- [ ] User can register a device.
- [ ] Device heartbeat updates last-seen time.
- [ ] Device status changes correctly.

### Events

- [ ] Simulator can send events.
- [ ] Backend validates events.
- [ ] Events are stored.
- [ ] Duplicate event IDs do not create duplicate records.

### Real-time

- [ ] Open dashboard receives event updates without refresh.
- [ ] WebSocket reconnects after temporary disconnection.

### Push notifications

- [ ] User can grant notification permission.
- [ ] Browser push subscription is saved.
- [ ] Backend can send a test notification.
- [ ] Medicine notifications can be triggered.
- [ ] Notifications work when the website tab/window is closed, subject to browser/OS support and permission.
- [ ] Notification click opens the relevant dashboard/patient page.

### History

- [ ] Medicine events appear in history.
- [ ] Filters work.
- [ ] Pagination works.

### Analytics

- [ ] Adherence percentage is calculated correctly.
- [ ] Dashboard displays basic adherence information.

---

# 40. Implementation Order for Claude Code

Implement in this order.

## Phase 1 — Project foundation

- Create monorepo.
- Set up React + TypeScript + Vite.
- Set up FastAPI.
- Set up PostgreSQL.
- Set up Docker Compose.
- Configure environment variables.
- Configure linting/formatting.

## Phase 2 — Authentication

- User model.
- Registration.
- Login.
- JWT.
- Protected routes.

## Phase 3 — Core data

- Patient model/API/UI.
- Medicine model/API/UI.
- Schedule model/API/UI.
- Device model/API/UI.

## Phase 4 — Dashboard

- Summary cards.
- Today's schedule.
- Recent events.
- Device status.
- Responsive UI.

## Phase 5 — Device simulator

- Simulator UI.
- Event API.
- Heartbeat API.
- Event persistence.
- Idempotency.

## Phase 6 — Real-time

- WebSocket backend.
- WebSocket frontend.
- Reconnection.
- Live dashboard updates.

## Phase 7 — Push notifications

- Service worker.
- Notification permission.
- Push subscription.
- VAPID configuration.
- Backend push service.
- Notification preferences.
- Test notification.

## Phase 8 — Medicine alert engine

- Due-dose detection.
- Dispensed event.
- Taken event.
- Missed-dose timeout.
- Duplicate prevention.

## Phase 9 — History and analytics

- Medicine history.
- Filters.
- Adherence calculations.
- Charts.

## Phase 10 — Hardening

- Tests.
- Validation.
- Security review.
- Error handling.
- Loading states.
- Empty states.
- Docker production build.
- Documentation.

---

# 41. Definition of Done

Do not consider the project complete merely because the pages render.

The MVP must demonstrate this complete software-only scenario:

```text
Caretaker logs in
       ↓
Creates patient
       ↓
Adds medicine
       ↓
Creates 8:00 PM schedule
       ↓
Registers MED-001
       ↓
Enables browser notifications
       ↓
Closes the web app
       ↓
Developer opens Device Simulator
       ↓
Simulates medicine event
       ↓
Backend receives event
       ↓
Database stores event
       ↓
Notification service sends push
       ↓
Caretaker receives OS/browser notification
       ↓
Caretaker opens notification
       ↓
Relevant patient/event page opens
```

This is the key demonstration for Version 1.

---

# 42. Future Roadmap

After the software MVP is stable:

## Version 2 — Hardware

Integrate:

- Arduino UNO
- DS3231
- Servo motors
- LCD
- Buttons
- Buzzer
- SIM800L
- Pickup sensor

## Version 3 — Device Management

Add:

- Firmware version
- GSM signal information
- Battery/power status where available
- Device configuration
- Remote diagnostics

## Version 4 — Advanced Analytics

Potential additions:

- Medication adherence trends
- Late-dose patterns
- Anomaly detection
- Predictive adherence insights

Any future AI functionality must be clearly separated from medical diagnosis or treatment decisions.

---

# 43. Important Architecture Rule

**Do not build the MVP around mocked hardware-specific code.**

Build around a clean device abstraction:

```text
Device Simulator ─┐
                  │
Arduino/SIM800L ──┼──> Device Event API
                  │
Future ESP32 ─────┘
```

The backend should receive standardized events regardless of the source device.

This ensures that the software can be completed and tested now, while the physical hardware can be integrated later.

---

# 44. Claude Code Implementation Instructions

When implementing this PRD:

1. Inspect the existing repository before creating files.
2. Do not overwrite existing working code without checking it first.
3. Build the project incrementally.
4. Keep frontend and backend clearly separated.
5. Use TypeScript types for API responses.
6. Use Pydantic schemas for backend validation.
7. Keep secrets in environment variables.
8. Do not hard-code credentials.
9. Write tests for important business logic.
10. Use realistic development seed data only.
11. Keep device integration behind an API abstraction.
12. Do not implement Arduino firmware in this phase.
13. Do not require physical hardware to demonstrate the MVP.
14. Make push notifications a first-class feature.
15. Do not fake successful push delivery; expose clear errors when push configuration is missing.
16. Provide `.env.example` files.
17. Provide setup instructions.
18. Provide API documentation.
19. Keep the application usable on mobile and desktop.
20. At the end of each major phase, run the relevant tests/build and fix errors before proceeding.

---

# 45. Final Product Vision

The finished system should eventually look like:

```text
                 SMART MEDICINE MANAGEMENT
                          │
        ┌─────────────────┴──────────────────┐
        │                                    │
        ▼                                    ▼
  PHYSICAL DEVICE                       CARETAKER APP
        │                                    │
 Arduino + GSM                         React PWA
        │                                    │
        └──────────────┐      ┌──────────────┘
                       ▼      ▼
                    BACKEND
                       │
              ┌────────┴─────────┐
              │                  │
              ▼                  ▼
           DATABASE        NOTIFICATION
                              SERVICE
                                 │
                                 ▼
                            🔔 Caretaker
```

The software should be useful and demonstrable **before the hardware exists**, while maintaining a stable API contract for the future hardware integration.
