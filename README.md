<p align="center">
  <img src="public/icons/logo.svg" alt="ServeFlow logo" width="96" />
</p>

<h1 align="center">ServeFlow</h1>

<p align="center">
  Ordering, kitchen workflow and sales management for a café or food vendor, used by its staff
  and administrators on a shared counter device.
</p>

<p align="center">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" />
  <img alt="TypeScript 6" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" />
  <img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" />
  <img alt="shadcn/ui" src="https://img.shields.io/badge/shadcn%2Fui-components-000000?logo=shadcnui&logoColor=white" />
  <img alt="React Router 8" src="https://img.shields.io/badge/React_Router-8-CA4245?logo=reactrouter&logoColor=white" />
  <img alt="Firebase 12" src="https://img.shields.io/badge/Firebase-12-DD2C00?logo=firebase&logoColor=white" />
  <img alt="Vitest 5" src="https://img.shields.io/badge/Vitest-5-6E9F18?logo=vitest&logoColor=white" />
  <img alt="Testing Library" src="https://img.shields.io/badge/Testing_Library-React-E33332?logo=testinglibrary&logoColor=white" />
  <img alt="Prettier 3" src="https://img.shields.io/badge/Prettier-3-F7B93E?logo=prettier&logoColor=black" />
</p>

## Overview

ServeFlow is a web-based point-of-sale and sales-management system. Staff ring up orders on a
shared touch device, move them through the kitchen and record payment; an administrator manages
the menu, cost prices and till operators, and reads the day's takings, cost and estimated profit.

It is a React single-page application running directly on Firebase Authentication and Cloud
Firestore. There is no application server and no Cloud Functions: Firestore security rules are
the authorization boundary, and the app is served from Firebase Hosting.

There are no customer accounts. Everyone who signs in works for the business, as either
**Staff** or **Admin**.

## Features

### Staff

- **New Order** — a touch terminal with the menu grouped by category, a running cart with
  quantity controls, and **dine-in** (with a required table number) or **takeaway**. The till
  asks who is making each order before it can be rung up.
- **Customisation** — items can offer modifier groups (for example sugar level or add-ons),
  single- or multiple-choice, required or optional, with per-option price adjustments.
- **Queue** — the kitchen board for the day: pending → preparing → ready → delivered, one step
  at a time, with a live timer from order creation to handover. A mis-tapped step can be taken
  back until the order is delivered, which is final.
- **Orders** — every order for a business date, with filters (payment state, fulfilment state,
  order type) and search. Orders are numbered per business date and cannot be edited.
- **Payment** — recorded as its own step, by cash (with change) or e-wallet, usually when the
  customer collects.
- **Voids** — staff can start a void on a sale; an administrator authorises it by signing in
  on the same screen.

### Admin

- **Dashboard** — today's orders, takings and kitchen state at a glance.
- **Reports** — any date range (presets or a custom range of up to 366 days): revenue,
  collected and outstanding money, estimated cost and profit, margin, cost coverage, payment
  breakdown, item performance and voided sales, with CSV export.
- **Orders** — the same order record staff see, with the ability to record payments and void a
  sale directly.
- **Menu management** — categories, items, prices, sort order, visibility and modifier groups
  (per item or shared across items), with translations for item and option names.
- **Cost prices** — an admin-only cost for each menu item and each modifier option, kept with
  an append-only history (see [Cost & Reporting](#cost--reporting)).
- **Staff roster** — the named till operators recorded on orders. They are identities, not
  Firebase accounts; operators can be added, renamed and deactivated but not deleted.

### Everyone

- **Settings** — the signed-in account's display name, the interface language and the colour
  theme (light, dark or follow the system).
- **Record keeping** — orders, payments and voids are immutable once written; every kitchen
  step is journalled; each record stores both the signed-in account and the till operator, and
  a void stores who requested it and who authorised it.

## Tech Stack

| Area            | Technology                                                                                 | Version (`package.json`) |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
| UI              | React, React DOM                                                                           | ^19.2                    |
| Language        | TypeScript                                                                                 | ~6.0                     |
| Build           | Vite with `@vitejs/plugin-react`                                                           | ^8.3                     |
| Styling         | Tailwind CSS (via `@tailwindcss/vite`), `tw-animate-css`                                   | ^4.3                     |
| Components      | shadcn/ui components on Radix UI primitives (`radix-ui`), `class-variance-authority`, `cn` | radix-ui ^1.6            |
| Icons           | Lucide React                                                                               | ^1.44                    |
| Font            | Geist (`@fontsource-variable/geist`)                                                       | ^5.3                     |
| Routing         | React Router                                                                               | ^8.3                     |
| Backend         | Firebase Authentication (email/password), Cloud Firestore                                  | firebase ^12.19          |
| Local dev       | Firebase Local Emulator Suite (Auth, Firestore), via `firebase-tools`                      | ^15.30                   |
| Hosting         | Firebase Hosting                                                                           | —                        |
| Tests           | Vitest, Testing Library (React, user-event), jsdom, `@firebase/rules-unit-testing`         | vitest ^5.0              |
| Lint and format | oxlint, Prettier                                                                           | ^1.81, ^3.9              |

Server state is read through small custom hooks over Firestore's live listeners rather than a
query library, and forms use plain component state with pure validation functions.

## Architecture

```text
Browser (React SPA)
  └─ Route guards        RequireAuth, RequireRole      src/features/auth/
      └─ Feature pages   POS, orders, queue, menu, reports, staff, settings
          ├─ Read hooks  live Firestore listeners, scoped to one business date or one document
          └─ Write APIs  one module per operation: create order, record payment, move an
                         order through the kitchen, void, edit the menu, manage the roster
              └─ Firebase JS SDK ──► Firebase Authentication
                                  └► Cloud Firestore ◄── firestore.rules
```

- **Feature-based source.** Each area of the product lives in `src/features/<area>/`, holding
  its pages, its Firestore hooks and write APIs, and its pure logic (cart arithmetic, money,
  fulfilment transitions, report aggregation). The pure modules have no React or Firestore
  imports, so they are unit-tested directly.
- **Shared UI.** `src/components/ui/` holds the shadcn/ui components, `src/components/layout/`
  the app shell (top bar, sidebar, mobile navigation) and `src/components/data/` the small
  display components used by the dashboard and reports.
- **Reads.** Pages subscribe to exactly what they show — the orders of one business date and
  their payment, fulfilment and void records — rather than whole collections. The Orders list
  and the Queue share one workspace hook, so both always show the same state for an order.
- **Writes.** Orders are never updated. Payment, fulfilment and voids are separate documents
  keyed by the order id, so the sale itself stays exactly as it was rung up. Order numbers come
  from a per-day counter updated in a transaction.
- **Security rules.** `firestore.rules` decide who may read and write what, and validate the
  shape and values of every write: role checks, required fields, the one-step-at-a-time
  kitchen workflow, amounts matching the order, and immutability. The route guards only keep
  people out of screens they cannot use.
- **Development and production.** Locally the app talks to the Firebase Local Emulator Suite;
  in production it is built by Vite and served from Firebase Hosting.

### Firestore collections

| Collection                                                                                 | Purpose                                                   |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `users`                                                                                    | Account profiles: display name, role, active flag         |
| `staffMembers`                                                                             | Named till operators                                      |
| `categories`, `menuItems`, `modifierGroups`                                                | The menu                                                  |
| `menuItemCosts`, `menuItemCostHistory`, `modifierOptionCosts`, `modifierOptionCostHistory` | Cost prices and their history (admin only)                |
| `orders`, `counters`                                                                       | Sales, and the per-day order number                       |
| `orderPayments`, `orderFulfillment` (+ `transitions`), `orderVoids`                        | Payment, kitchen state and its journal, and cancellations |

## Project Structure

```text
├── public/
│   ├── manifest.webmanifest    Web app manifest
│   └── icons/                  Logo, wordmark, favicon and PWA icons
├── src/
│   ├── App.tsx                 Routes and providers
│   ├── main.tsx                Entry point
│   ├── index.css               Tailwind theme and design tokens
│   ├── components/
│   │   ├── ui/                 shadcn/ui components
│   │   ├── layout/             App shell, navigation
│   │   └── data/               Stat cards, panels, empty states
│   ├── features/
│   │   ├── auth/               Sign-in, AuthProvider, route guards, profiles
│   │   ├── pos/                New Order, Orders, Queue, payments, fulfilment, voids
│   │   ├── menu/               Menu, categories, modifiers, costs, translations
│   │   ├── reports/            Report data, aggregation, CSV export
│   │   ├── dashboard/          Today's summary
│   │   ├── staff/              Till operator roster and selection
│   │   ├── settings/           Account, language and theme
│   │   ├── i18n/               Languages, dictionaries, LanguageProvider
│   │   └── theme/              Light, dark and system theme
│   ├── lib/                    Firebase setup, environment checks, money, shared hooks
│   └── pages/                  403 and 404 pages
├── tests/
│   ├── unit/                   Pure logic
│   ├── components/             React components in jsdom
│   ├── rules/                  Firestore security rules
│   └── integration/            Write APIs against the emulators
├── design/                     Source artwork (not shipped)
├── firebase.json               Emulators, Hosting and rules configuration
├── firestore.rules             Security rules
├── firestore.indexes.json      Firestore indexes
└── .env.example                Required environment variable names
```

## Authentication & Authorization

- **Firebase Email/Password Authentication.** There is no sign-up screen and no customer
  account. Accounts are created by an administrator in Firebase Authentication, and each needs
  a profile document at `users/{uid}` holding its `role` (`admin` or `staff`), `displayName`
  and `active` flag.
- **Profile checks.** A signed-in user with no profile, or with `active: false`, is signed out
  again. A deactivated profile ends an open session without a reload.
- **Roles.** Staff reach New Order, Queue, Orders and Settings; admins reach Dashboard,
  Reports, Orders, Menu, Staff and Settings. The kitchen workflow belongs to staff; menu, cost,
  roster and reporting data belong to admins.
- **Enforcement.** Route guards (`RequireAuth`, `RequireRole`) keep people out of screens they
  cannot use, but the real boundary is `firestore.rules`: a staff account cannot read cost data,
  edit the menu or void a sale however the request is made.
- **Manager authorisation.** When staff start a void, an administrator signs in on a second,
  in-memory Firebase Auth session that exists only for that one write. The till's own session is
  never elevated.
- **Till operators** chosen on the device are a record of who did what, not an authorization
  boundary.

## Cost & Reporting

Reports estimate cost and profit from the cost prices administrators record.

- **Recorded costs.** Each menu item and each modifier option can have a cost price, visible
  only to administrators.
- **History.** Every change is appended to a cost history with the time it took effect
  (`effectiveFrom`). History entries are never edited or deleted.
- **Cost at the time of sale.** For each order line, reports use the newest history entry whose
  `effectiveFrom` is on or before the order's `createdAt`. Changing a cost today therefore never
  changes the cost, profit or margin of sales already made.
- **Missing costs.** A line with no cost in force when it was sold is left uncosted rather than
  given an invented figure. Reports show cost coverage — the share of revenue whose cost is
  known — and treat profit as an upper bound when coverage is incomplete. An item recorded
  before cost history existed, and never changed since, uses its current cost.
- **Voided sales** are excluded from revenue, cost and profit and listed separately.

## Internationalization

- **Languages:** English, Bahasa Melayu and Chinese (Simplified). The language is chosen per
  device, stored in `localStorage` and applied to `<html lang>`. English is the fallback.
- **Dictionaries:** interface text lives in typed dictionaries in
  `src/features/i18n/translations/`, with `en.ts` as the source of truth. Every dictionary has
  the `Dictionary` type, so a missing key is a build error.
- **Vendor text stays as typed.** Categories, modifier group names, staff names and void reasons
  are shown exactly as entered. Components can only translate keys, not arbitrary strings.
- **Multilingual menu names.** A menu item's name and a modifier option's name can each be
  translated by the vendor; a missing translation falls back to English.
- **Orders keep what the customer was shown.** The item and option names are snapshotted onto
  each order line in the till's language, so later renames or translations never change a past
  sale.
- CSV exports keep stable English column headers.

To add a language, add its code, endonym and tag in `src/features/i18n/languages.ts`, copy
`translations/en.ts` to a new dictionary typed as `Dictionary`, and register it in
`LanguageProvider.tsx`.

## PWA & Hosting

- ServeFlow can be installed from the browser as a standalone app. `public/manifest.webmanifest`
  sets the name, the `standalone` display mode, `/` as start URL and scope, the theme colour, and
  192 × 192, 512 × 512 and maskable 512 × 512 icons. Orientation is not locked.
- There is **no service worker and no offline mode**: the app needs a network connection.
- Firebase Hosting serves the Vite build from `dist/`, rewrites every path to `index.html` for
  client-side routing, caches hashed assets for a year and always revalidates `index.html`.

## Getting Started

### Prerequisites

| Requirement         | Notes                               |
| ------------------- | ----------------------------------- |
| Node.js 22 or newer | Developed on Node 24.               |
| JDK 21 or newer     | Required by the Firebase emulators. |
| A Firebase project  | The free Spark plan is sufficient.  |

The Firebase CLI is a dev dependency, so nothing needs installing globally; run it with `npx`.

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. In the Firebase console, add a Web app, enable **Authentication → Email/Password** and create
   a **Firestore** database.
3. Copy `.env.example` to `.env.local` and fill in the values from **Project settings → General →
   Your apps**. Keep `VITE_USE_EMULATORS=true` for local development. Set your project id in
   `.firebaserc`. `.env.local` is gitignored; a missing variable stops the app at startup and names
   the one that is missing.
4. Create accounts: add a user in Authentication (the Emulator UI locally, the Firebase console
   in production), then create `users/{uid}` in Firestore with `uid`, `email`, `displayName`,
   `role` (`admin` or `staff`), `active: true` and `createdAt`.

### Running locally

```bash
npm run emulators   # Auth, Firestore and the Emulator UI (ports in firebase.json)
npm run dev         # Vite dev server
```

Emulator data is held in memory and is lost when the emulators stop.

### Scripts

| Command                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start the Vite dev server           |
| `npm run build`        | Type-check and build for production |
| `npm run preview`      | Serve the production build locally  |
| `npm run typecheck`    | TypeScript project build (`tsc -b`) |
| `npm run lint`         | Lint with oxlint                    |
| `npm run format`       | Format with Prettier                |
| `npm run format:check` | Check formatting                    |
| `npm run emulators`    | Start the Firebase emulators        |
| `npm test`             | Run every test suite                |

## Testing

| Command                    | Suite                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run test:unit`        | Pure logic: money, cart, fulfilment, reports, cost history, i18n |
| `npm run test:components`  | React components in jsdom with Testing Library                   |
| `npm run test:rules`       | `firestore.rules` against the Firestore emulator                 |
| `npm run test:integration` | The app's write APIs against the Firestore and Auth emulators    |

All suites run on Vitest. The rules and integration suites start their own emulators with
`firebase emulators:exec`, so stop `npm run emulators` before running them. Each suite uses its
own test project id, so none of them can reach a real project.

## Deployment

Production configuration goes in `.env.production.local` (gitignored) with
`VITE_USE_EMULATORS=false`. Then:

```bash
npx firebase deploy --only hosting
```

`firebase.json` runs `npm run build` before every Hosting deploy. Security rules are deployed
separately when they change:

```bash
npx firebase deploy --only firestore:rules
```

## Known limitations

- Firestore rules cannot sum a list, so an order's `total` is not re-verified against its lines
  on the server; the cart arithmetic is guarded by tested pure functions.
- Estimated profit is an upper bound wherever cost coverage is incomplete.
- Till operator attribution is a record, not an authorization control — the signed-in role is
  the only real gate.
- Without a service worker, the installed app does not work offline.
