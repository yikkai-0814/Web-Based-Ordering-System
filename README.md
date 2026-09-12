# Web-Based Ordering System

A point-of-sale and sales-management system for a café or food vendor. Staff ring up orders
on a shared touch terminal, move them through the kitchen, and take payment; an administrator
manages the menu and staff roster and reads the day's takings, cost and estimated profit. It
is a React single-page app backed by Firebase Authentication and Cloud Firestore, with
security rules as the real authorization boundary.

## Features

- **Ordering** — touch terminal with categories, cart, dine-in or takeaway, and a table
  number for dine-in. Orders are numbered per business date and are immutable once written.
- **Payment** — cash (with change calculation) or e-wallet, recorded as a separate step after
  the order is placed.
- **Kitchen queue** — pending → preparing → ready → delivered, one step at a time, with every
  step journalled.
- **Voids** — a cancelled sale is a counter-entry, never an edit. Staff can start one; a
  manager authorises it with their own credentials.
- **Menu and cost** — categories and priced items, with an admin-only cost per item and an
  append-only history so past orders keep the cost that applied when they were sold.
- **Staff identities** — named till operators without Firebase accounts, recorded on every
  order, payment, fulfilment step and void.
- **Dashboard and reports** — today at a glance, and an admin report over any date range with
  revenue, collected and outstanding money, cost, estimated profit, payment mix, item
  performance and voids, exportable as CSV.
- **Roles** — admin and staff, enforced by Firestore security rules.
- **Light / dark / system theme**, a collapsible sidebar, and a layout that works from a phone
  to a desktop.

## Tech stack

- **React 19** + **TypeScript**, built with **Vite**
- **Tailwind CSS v4** with shadcn-style components on Radix primitives
- **Firebase**: Authentication (email/password) and Cloud Firestore
- **Vitest** for all four test suites, with **@testing-library/react** for components and
  **@firebase/rules-unit-testing** for security rules
- **oxlint** and **Prettier**

No Cloud Functions: the free Spark plan is enough to run this.

## Getting started

### Prerequisites

| Requirement             | Notes                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Node.js 22 LTS or newer | Developed on Node 24.                                                                                         |
| JDK 21 or newer         | Required by the Firebase emulators. Windows: `winget install Microsoft.OpenJDK.21`, then open a new terminal. |
| A Firebase project      | The free Spark plan is sufficient.                                                                            |

The Firebase CLI ships as a dev dependency, so there is nothing to install globally.

If `npm run emulators` reports `Java version before 21`, an older Java is still first on your
`PATH` — on Windows usually `C:\Program Files (x86)\Common Files\Oracle\Java\javapath`. Point
`JAVA_HOME` at the new JDK and put its `bin` ahead of that entry.

### 1. Install

```bash
npm install
```

### 2. Create the Firebase project

1. Create a project in the [Firebase console](https://console.firebase.google.com).
2. Add a **Web app** (the `</>` icon).
3. Under **Authentication → Sign-in method**, enable **Email/Password**.
4. Under **Firestore Database**, create a database in production mode. The rules in this
   repository replace whatever is there when you deploy them.

### 3. Configure the environment

```bash
cp .env.example .env.local
```

Fill in the values from **Project settings → General → Your apps → SDK setup and
configuration**:

| `.env.local` variable               | Firebase config key |
| ----------------------------------- | ------------------- |
| `VITE_FIREBASE_API_KEY`             | `apiKey`            |
| `VITE_FIREBASE_AUTH_DOMAIN`         | `authDomain`        |
| `VITE_FIREBASE_PROJECT_ID`          | `projectId`         |
| `VITE_FIREBASE_STORAGE_BUCKET`      | `storageBucket`     |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID`              | `appId`             |

Leave `VITE_USE_EMULATORS=true` for local development, and set your project id in
`.firebaserc`, replacing `your-project-id`.

`.env.local` is gitignored and never written automatically. If a required variable is
missing, the app stops at startup naming exactly which one rather than failing later with an
opaque Firebase error.

> A Firebase web API key is not a secret — it identifies the project and grants nothing.
> `firestore.rules` is what protects the data. `.env.local` is gitignored so each developer
> can point at their own project.

### 4. Create the first accounts

**There is no sign-up screen, by design.** Accounts are created by an administrator — locally
in the Emulator UI, in production in the Firebase console. Either way:

1. In **Authentication**, add a user with an email and password, and copy its **UID**.
2. In **Firestore**, create `users/{UID}` — the document id must be exactly that UID — with
   `uid` (string), `email` (string), `displayName` (string), `role` (`admin` or `staff`),
   `active` (boolean) and `createdAt` (timestamp).

Create one of each role to exercise both sides of the role gate. A signed-in user with no
`users/{uid}` document, or with `active: false`, is signed out again with an explanation:
authenticating is not the same as being authorised.

## Running the application

```bash
npm run emulators   # Auth :9099, Firestore :8080, Emulator UI :4000
npm run dev         # Vite dev server
```

Start the emulators first. Note that they and the emulator-backed test suites compete for the
same ports — stop `npm run emulators` before running those tests.

## Testing

| Command                    | What it runs                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| `npm test`                 | All four suites: unit, components, rules, then integration               |
| `npm run test:unit`        | Pure logic — money, cart, dates, aggregation. No emulator                |
| `npm run test:components`  | React components in jsdom, driven by real clicks and typing. No emulator |
| `npm run test:rules`       | Security rules against the Firestore emulator                            |
| `npm run test:integration` | The app's own write APIs against the Firestore **and Auth** emulators    |

Each suite answers a question the others cannot: is the logic right, does the screen do what
the operator expects, would the database accept this document from this caller, and is this
the document the app actually sends.

| Command                | What it does                                |
| ---------------------- | ------------------------------------------- |
| `npm run typecheck`    | TypeScript, no emit                         |
| `npm run lint`         | oxlint                                      |
| `npm run format`       | Prettier, writing changes                   |
| `npm run format:check` | Prettier, checking only                     |
| `npm run build`        | Typecheck, then production build to `dist/` |
| `npm run preview`      | Serve the production build locally          |

## Architecture notes

### Authorization

`firestore.rules` is the boundary; the route guards are only user experience. Every rule
judges the caller's own profile (`users/{uid}`), so a role change or a deactivation takes
effect in an open session without a re-login. Each validated write also states the exact set
of keys it may carry, so a client cannot attach fields the app never writes.

### Orders are immutable

An order is never updated or deleted — by anyone, admins included. Everything that happens to
it afterwards lives in its own document keyed by the order id:

- `orderPayments/{orderId}` — one payment, never edited
- `orderFulfillment/{orderId}` + a `transitions` journal — forward-only, one entry per step
- `orderVoids/{orderId}` — a counter-entry; the same order cannot be voided twice

Order numbers come from `counters/{businessDate}` inside a transaction, so two tills cannot
issue the same number.

### Money and business dates

All money is stored as **whole sen** (integers) and formatted for display only — no floats
anywhere. A sale belongs to the local calendar date it was rung up on, and every list, report
and counter is keyed on that date.

### Staff operators

A stall shares one device and one login, so the Firebase account cannot say who served a
customer. Each order, payment, fulfilment step and void therefore records two identities: the
signed-in account, and the till operator. **New Order asks who is making each order, every
time** — the previous answer is never reused, because the person who rang up the last order is
not necessarily ringing up the next. The selection is stored per device and scoped to the
account that made it, so signing in as somebody else never inherits it.

### Voids need a manager

Staff can start a void; completing one requires an admin's credentials, entered into a second,
in-memory Auth session that lasts exactly one write. The write therefore arrives carrying an
admin's token and the rules need no special case. There is deliberately **no PIN**: rules
cannot rate-limit, and a PIN checked by rules would have to travel inside the void document,
where staff could read it back. The void records who authorised it and who asked for it.

### Historical cost

An item's current cost lives in `menuItemCosts/{itemId}` (admin-only), and every change
appends to `menuItemCostHistory` with an `effectiveFrom` timestamp. Reports resolve each order
line against the cost that was in force when the order was created, so repricing an item today
never rewrites what last month's orders cost. Order lines also snapshot the item's name and
price, so renaming or deleting an item leaves past receipts intact.

### Data model

```
users/{uid}                 uid, email, displayName, role, active, createdAt
categories/{id}             name, sortOrder, active, createdAt, updatedAt
menuItems/{id}              name, description, categoryId, price (sen), sortOrder,
                            active, createdAt, updatedAt
menuItemCosts/{id}          cost (sen), updatedAt              ← admin only
menuItemCostHistory/{id}    itemId, cost, effectiveFrom, recordedBy
                                                               ← admin only, append-only
orders/{orderId}            number, businessDate, lines[], total (sen), orderType,
                            tableNumber (dine-in only), createdAt, createdBy,
                            createdByName, staffId, staffName      ← IMMUTABLE, no payment
orderPayments/{orderId}     method, amount, cashTendered, changeGiven, paidAt,
                            paidBy, paidByName, paidByStaffId, paidByStaffName
orderFulfillment/{orderId}  status, updatedAt, updatedBy, updatedByName,
                            updatedByStaffId, updatedByStaffName   ← absent means pending
  .../transitions/{id}      from, to, at, and the same two identities
counters/{businessDate}     lastNumber
orderVoids/{orderId}        reason, amount, voidedAt, voidedBy, voidedByName,
                            initiatedByStaffId, initiatedByStaffName
staffMembers/{id}           name, active, createdAt, updatedAt     ← admin write, no delete
```

Retiring a menu item or a staff member is deactivation, never deletion: history points at
these records.

### Project layout

```
src/
├─ components/   ui/ (shadcn primitives), data/ (stat cards, meters, panels), layout/
├─ features/     auth, dashboard, menu, pos, reports, staff, theme
└─ lib/          firebase, env, money, utils
tests/           unit, components, rules, integration
firestore.rules  the authorization boundary
```

## Limitations

- **The rules cannot verify that an order's `total` matches its `lines`.** Rules cannot
  iterate or sum a list, and checking each line's price would exceed the per-request document
  limit. The cart arithmetic is guarded by pure functions and their tests, but a client-side
  check is not a control: an active staff account calling Firestore directly could write an
  order whose total disagrees with its lines. Closing this needs a server-side write — Cloud
  Functions on the Blaze plan.
- **Estimated profit is an upper bound when an item has no recorded cost.** Every menu item is
  meant to have one, so this is treated as a data-integrity exception: the item table marks
  the rows involved and a notice says to record their cost.
- **No historical trend data.** Reports aggregate a chosen date range into totals; there is no
  per-day series and no charting library.
- **Attribution is a visible record, not an authorisation boundary.** Operators are named and
  permanent, but selecting one proves nothing — the signed-in role is the only real gate.

## Not in scope

Deliberately absent and not scaffolded ahead of time: partial and line-level refunds, PINs and
any client-side secret verification, tax, service charge and discounts, payroll, attendance
and shifts, per-staff sales reports, charts and charting libraries, Excel and PDF export,
scheduled reports, pre-aggregated rollups, held or parked orders, table service, customer
accounts, **inventory in every form** (stock, recipes, ingredients, suppliers, purchasing), an
in-app user-management screen, cash-drawer handling, offline/PWA support, multi-outlet
tenancy, general audit logging, receipt printing, and deployment/CI.
