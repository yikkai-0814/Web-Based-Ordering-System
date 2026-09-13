# Web-Based Ordering System

A point-of-sale and sales-management system for a café or food vendor. Staff ring up orders on
a shared touch terminal, move them through the kitchen and take payment; an administrator
manages the menu and staff roster and reads the day's takings, cost and estimated profit.

React single-page app on Firebase Authentication and Cloud Firestore, with security rules as
the real authorization boundary. No Cloud Functions — the free Spark plan is enough.

## Features

- **Ordering** — touch terminal with categories, cart, dine-in or takeaway. Per-item
  customisation (e.g. "No vegetables", "Extra egg +RM1") configured by an admin. Orders are
  numbered per business date and immutable once written.
- **Payment** — cash (with change) or e-wallet, recorded as a separate step after the order.
- **Kitchen queue** — pending → preparing → ready → delivered, one step at a time, journalled,
  with a live timer from order creation to delivery.
- **Voids** — a cancelled sale is a counter-entry, never an edit; a manager authorises it.
- **Menu and cost** — categories, priced items and modifier groups, plus an admin-only cost per
  item with an append-only history so past orders keep the cost that applied then.
- **Staff identities** — named till operators without Firebase accounts, recorded on every
  order, payment, fulfilment step and void.
- **Dashboard and reports** — today at a glance, and an admin report over any date range with
  revenue, outstanding money, cost, estimated profit and item performance, exportable as CSV.
- **Roles** — staff get New Order, Orders and Queue; admins get Dashboard, Reports, Orders,
  Menu and Staff. Enforced by route guards and Firestore rules.

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS v4 with shadcn-style components on Radix ·
Firebase Auth + Cloud Firestore · Vitest, Testing Library and `@firebase/rules-unit-testing` ·
oxlint · Prettier

## Prerequisites

| Requirement             | Notes                                                                       |
| ----------------------- | --------------------------------------------------------------------------- |
| Node.js 22 LTS or newer | Developed on Node 24.                                                       |
| JDK 21 or newer         | For the Firebase emulators. Windows: `winget install Microsoft.OpenJDK.21`. |
| A Firebase project      | The free Spark plan is sufficient.                                          |

The Firebase CLI ships as a dev dependency; nothing to install globally.

## Setup

1. **Install** — `npm install`

2. **Create the Firebase project** — add a Web app, enable **Authentication → Email/Password**,
   and create a **Firestore** database.

3. **Configure the environment** — `cp .env.example .env.local` and fill in the values from
   **Project settings → General → Your apps → SDK setup**. Set your project id in `.firebaserc`
   too. Leave `VITE_USE_EMULATORS=true` for local development.

   `.env.local` is gitignored and never written automatically. A missing variable stops the app
   at startup naming exactly which one.

4. **Create the first accounts** — there is no sign-up screen, by design. For each account, add
   a user under **Authentication** (the Emulator UI locally, the Firebase console in
   production), copy its **UID**, then create `users/{UID}` in Firestore with `uid`, `email`,
   `displayName`, `role` (`admin` or `staff`), `active` and `createdAt`. Create one of each
   role. A signed-in user with no profile, or with `active: false`, is signed out again.

## Running

```bash
npm run emulators   # Auth :9099, Firestore :8080, Emulator UI :4000
npm run dev         # Vite dev server
```

Start the emulators first. The emulator data is in memory only, so accounts and orders are lost
when they stop.

## Testing

| Command                    | What it runs                                                  |
| -------------------------- | ------------------------------------------------------------- |
| `npm test`                 | All four suites                                               |
| `npm run test:unit`        | Pure logic — money, cart, dates, aggregation                  |
| `npm run test:components`  | React components in jsdom                                     |
| `npm run test:rules`       | Security rules against the Firestore emulator                 |
| `npm run test:integration` | The app's write APIs against the Firestore and Auth emulators |

The emulator-backed suites start their own emulators, so stop `npm run emulators` before
running them.

Also available: `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`.

## Known limits

- Rules cannot sum a list, so an order's `total` is not verified against its `lines` on the
  server. Cart arithmetic is guarded by pure functions and their tests, which is not a control.
  Closing it needs a server-side write (Blaze plan).
- Estimated profit is an upper bound for any item with no recorded cost; those rows are flagged.
- Operator attribution is a visible record, not an authorisation boundary — the signed-in role
  is the only real gate.
