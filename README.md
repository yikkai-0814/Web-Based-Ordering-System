# Web-Based Ordering System

A café / food-vendor point-of-sale and sales management system, built one phase at a time.

**Phase 1** built the foundation: tooling, styling, Firebase configuration, the emulator
suite, email/password authentication, Admin/Staff roles, Firestore security rules,
protected routing, and a role-aware layout.

**Phase 2** added the menu catalog: categories and priced items, managed by an admin and
read by staff, with costs visible to admins only.

**Phase 3** adds the till: a touch-operated terminal, a cart, cash or e-wallet payment,
and an immutable order with a daily number and snapshotted line items.

Still to come — no voids or refunds, no tax or discounts, no reports, no receipt printing.
The dashboard and admin pages remain deliberate placeholders that prove access control
works end to end.

---

## Prerequisites

| Requirement                | Notes                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 22 LTS or newer    | Developed and verified on Node 24.                                                                                                                             |
| A JDK, version 21 or newer | **Required by the Firebase emulators** — `firebase-tools` refuses anything older. On Windows: `winget install Microsoft.OpenJDK.21`, then open a new terminal. |
| A Firebase project         | Free Spark plan is sufficient — no Cloud Functions are used.                                                                                                   |

The Firebase CLI is a project dev dependency, so there is nothing to install globally.

If `npm run emulators` reports `Java version before 21`, an older Java is still first on
your `PATH` — on Windows that is usually `C:\Program Files (x86)\Common Files\Oracle\Java\javapath`.
Point `JAVA_HOME` at the new JDK and put its `bin` ahead of that entry.

---

## First-run setup

```bash
npm install
```

### 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com) and create a project.
2. Add a **Web app** to it (the `</>` icon). You do not need Firebase Hosting yet.
3. Under **Authentication → Sign-in method**, enable **Email/Password**.
4. Under **Firestore Database**, create a database. Choose production mode; the rules in
   this repository replace whatever is there when you deploy them.

### 2. Configure your environment

Copy the example file and fill in your own values:

```bash
cp .env.example .env.local
```

The values come from **Project settings → General → Your apps → SDK setup and
configuration**. Map them like this:

| `.env.local` variable               | Firebase config key |
| ----------------------------------- | ------------------- |
| `VITE_FIREBASE_API_KEY`             | `apiKey`            |
| `VITE_FIREBASE_AUTH_DOMAIN`         | `authDomain`        |
| `VITE_FIREBASE_PROJECT_ID`          | `projectId`         |
| `VITE_FIREBASE_STORAGE_BUCKET`      | `storageBucket`     |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID`              | `appId`             |

Leave `VITE_USE_EMULATORS=true` for local development.

`.env.local` is gitignored and is never created or filled in automatically — it is yours.
If any required variable is missing, the app stops at startup with a message naming
exactly which ones, rather than failing later with an opaque Firebase error.

> **A Firebase web API key is not a secret.** It identifies the project; it does not grant
> access to anything. What protects the data is `firestore.rules`. `.env.local` is
> gitignored so that each developer can point at their own project, not because the
> contents are sensitive.

Also set your project id in `.firebaserc`, replacing `your-project-id`.

### 3. Start the emulators

```bash
npm run emulators
```

This starts the Auth emulator on `:9099`, Firestore on `:8080`, and the Emulator UI on
[localhost:4000](http://localhost:4000). If it fails immediately, check your Java version —
see Prerequisites. The CLI may also warn that you are not authenticated; run
`npx firebase login` once if you want that warning to go away.

### 4. Create the first accounts

There is **no sign-up screen** in the app, by design. Accounts are created by an
administrator. Locally that means the Emulator UI; in production, the Firebase Console.
The steps are identical:

1. Open the **Authentication** tab and click **Add user**. Enter an email and password.
2. Copy the new user's **UID**.
3. Open the **Firestore** tab and create a document at `users/{UID}` — the document id must
   be exactly that UID — with these fields:

   | Field         | Type      | Value              |
   | ------------- | --------- | ------------------ |
   | `uid`         | string    | the same UID       |
   | `email`       | string    | the email you used |
   | `displayName` | string    | e.g. `Ada Admin`   |
   | `role`        | string    | `admin`            |
   | `active`      | boolean   | `true`             |
   | `createdAt`   | timestamp | now                |

4. Repeat steps 1–3 for a second account with `role` set to `staff`, so you can test both
   sides of the role gate.

A signed-in user with no `users/{uid}` document, or with `active: false`, is signed out
again immediately with an explanation. That is intentional: authenticating is not the same
as being authorised to use the system.

### 5. Run the app

```bash
npm run dev
```

---

## Scripts

| Script               | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| `npm run dev`        | Vite dev server                                                          |
| `npm run build`      | Typecheck, then production build to `dist/`                              |
| `npm run preview`    | Serve the production build locally                                       |
| `npm run typecheck`  | TypeScript only, no emit                                                 |
| `npm run lint`       | oxlint                                                                   |
| `npm run format`     | Prettier, writing changes                                                |
| `npm run emulators`  | Start the Firebase Emulator Suite                                        |
| `npm test`           | Both suites: unit then rules                                             |
| `npm run test:unit`  | Pure-logic tests (money and cart arithmetic). No emulator needed         |
| `npm run test:rules` | Start the Firestore emulator and run the security-rules tests against it |

---

## Security model

Read this before adding features.

**Route guards are user experience. Security rules are enforcement.**

This is a client-only single-page app. `RequireAuth` and `RequireRole` stop a staff member
wandering into a page they cannot use, but anyone can open devtools and call Firestore
directly, bypassing every component in `src/`. The only thing standing between a user and
the data is `firestore.rules`.

So the rules deny everything by default and open up one collection at a time, and
`tests/rules/firestore.rules.test.ts` proves the important cases — including that a staff
account cannot promote itself to admin or reactivate itself. **Every phase that adds a
collection adds rules and rule tests for it in the same phase.**

Roles live in the `users/{uid}` document rather than in a custom auth claim, and the app
subscribes to that document live. An admin who changes someone's role or sets
`active: false` sees it take effect in that person's open session, without waiting for a
re-login.

---

## Money

**Prices are integers in sen. RM 12.50 is stored as `1250`, never as `12.5`.**

Floating-point money is the classic point-of-sale defect: the error is invisible on a
single item and compounds across a cart until the printed total disagrees with the cash
drawer. `parseFloat('1.15') * 100` is `114.99999999999999`, and that is how a menu quietly
goes a cent out.

All conversion lives in `src/lib/money.ts` — `parsePriceInput` (text from a form to sen)
and `formatMoney` (sen to `"RM 12.50"`). **Nothing else in the codebase should multiply or
divide a price by 100.** The currency is two constants at the top of that file.

The security rules enforce the same invariant with `price is int && price >= 0`, so a
float cannot be written even by something that bypasses the form entirely.

---

## Data model

```
users/{uid}          uid, email, displayName, role: 'admin'|'staff', active, createdAt
categories/{id}      name, sortOrder, active, createdAt, updatedAt
menuItems/{id}       name, description, categoryId, price (sen), sortOrder, active,
                     createdAt, updatedAt
menuItemCosts/{id}   cost (sen), updatedAt          ← ADMIN ONLY, same id as the item
menuItemCostHistory/{autoId}
                     itemId, cost (sen|null), effectiveFrom, recordedBy
                                                    ← ADMIN ONLY, append-only journal
orders/{orderId}     number, businessDate, lines[], total (sen), paymentMethod
                     ('cash' | 'ewallet'),
                     cashTendered, changeGiven, createdAt, createdBy, createdByName
                                                    ← IMMUTABLE once written
counters/{businessDate}
                     lastNumber                     ← issues the daily order number
```

### Orders are immutable

`allow update, delete: if false` — for **everyone**, admins included. A sale is a financial
record; correcting one is a new entry, not an edit. When voids arrive they will write a
counter-entry rather than mutate the original.

Order lines **snapshot** `name` and `unitPrice` at the time of sale and never reference the
menu item. That is what makes renaming, repricing or deleting a menu item safe: a price
change tomorrow cannot rewrite today's receipt. The cart follows the same rule — a line
keeps the price the customer was quoted even if an admin edits it mid-order.

**What the rules can and cannot check.** Firestore rules cannot iterate or sum a list, so
they **cannot verify that `total` equals the sum of `lines`**. They do check every scalar:
types and ranges, the payment-method enum, that the sale is attributed to the caller, and
that `changeGiven` is exactly `cashTendered - total`. The cart arithmetic itself is guarded
by the pure functions in `src/features/pos/cart.ts` and their unit tests. Closing that last
gap would need a Cloud Function.

### Payment methods

Two, and only two: **Cash** and **E-Wallet**. The `ewallet` value covers every cashless
method the vendor accepts — DuitNow QR and the various wallet apps are one thing at the
counter, so they are one value rather than a distinction nobody makes.

**E-Wallet is recorded, not integrated.** Choosing it labels the sale and nothing more —
there is no payment gateway, and the system never learns whether the transfer actually
succeeded. The person at the till confirms that on the customer's phone, exactly as they
would without this system. Only cash has arithmetic behind it: amount tendered, and change
due computed to the sen.

The enum lives in `src/features/pos/types.ts` and is mirrored in `firestore.rules`. Because
orders are immutable, adding a method later is safe, but **renaming or removing one strands
past orders** that still carry the old value — `parseOrder` will reject them and they will
vanish from the list. Change the enum only while the data is disposable.

### Order numbering

Each sale gets a per-day sequence number, assigned in the **same transaction** that writes
the order: read `counters/{businessDate}`, advance it by one, stamp the order. The rules
allow `lastNumber` to increase by exactly one and nothing else, so a number cannot be
skipped, reused or rewound by a tampered client.

One Firestore document sustains roughly one write per second, and every sale that day
touches this single counter. Far above a café counter's rate, but it is the ceiling of this
design and the thing to revisit for multiple simultaneous tills.

### Resolving historical cost

Costs change, so margin for a past sale needs the cost that was in force at the time.
Orders deliberately carry **no** cost: staff ring up sales and staff cannot read costs, so
they could not stamp one on even if asked. Instead every admin cost change appends a dated
entry to `menuItemCostHistory`, in the same batch as the cost itself.

To resolve the cost for an order, take the newest history entry for that item whose
`effectiveFrom` precedes the order, and fall back to the current `menuItemCosts` value when
an item has no history — an item never edited since keeps its current cost as its only
value, which correctly applies to all time. No backfill is needed.

### Why cost lives in its own collection

Firestore grants or denies **a whole document** — there is no field-level read permission.
Staff must read `menuItems` to serve customers, so a `cost` field on that document would be
readable by every staff account no matter what the UI showed. Hiding a column would leave
the cost one devtools tab away.

Keying an admin-only `menuItemCosts` collection by the item's own id is what makes "staff
cannot see cost" true rather than merely apparent. Item and cost are written together in a
`writeBatch` so they cannot drift apart, and deleting an item deletes its cost in the same
batch.

Cost is **optional**, and absent is not zero: an unrecorded cost stores no document and
renders as `—`. Recording it as `0` would claim the item is free to make and would poison
any margin figure later derived from it.

Profit and margin are **not computed or stored anywhere yet**. When reporting arrives it
will need to snapshot cost onto each order line, for the same reason order lines snapshot
price: today's cost cannot answer what last month's margin was.

`categories` and `menuItems` are readable by any signed-in **active** user — staff serve
from the menu — and writable only by an admin. `menuItemCosts` is admin-only for both read
and write. Every document is validated by a `parse*` function before the app trusts it, so
a malformed document is skipped rather than rendered.

**Archive vs delete.** Setting `active: false` archives an item: it stays in the catalog
for admins but is out of service. Deleting removes it outright. Deleting stays safe because
when orders arrive in a later phase, each order line will **snapshot** the item's name and
price at the time of sale rather than referencing the item document — a price change must
never rewrite yesterday's receipts.

The catalog is fetched whole and filtered in memory rather than queried per category. A
café menu is tens of items, so this keeps `firestore.indexes.json` empty and avoids index
deploys. `src/features/menu/use-collection.ts` is the single place to revisit if that ever
stops being true.

---

## Project structure

```
src/
├─ main.tsx                    React root
├─ App.tsx                     AuthProvider + route tree
├─ index.css                   Tailwind entry + design tokens
├─ components/
│  ├─ ui/                      shadcn primitives (generated; not hand-edited)
│  └─ layout/                  AppShell, Sidebar, Topbar, UserMenu, nav-items
├─ features/
│  ├─ auth/                    AuthProvider, useAuth, RequireAuth, RequireRole, LoginPage
│  ├─ menu/                    catalog: hooks, write API, list/form/categories pages
│  └─ pos/                     till: pure cart logic, order transaction, receipt pages
├─ lib/                        firebase, env, auth-errors, money, utils
└─ pages/                      Dashboard, Admin, 403, 404

tests/rules/                   Firestore security-rules tests
firestore.rules                The authorization boundary
```

Architecture is feature-first: cross-cutting code lives in `src/lib` and `src/components`,
and each domain gets its own `src/features/<domain>/`. Phase 1 creates exactly one feature
(`auth`), establishing the pattern without pre-building anything else. Navigation is
declared as data in `src/components/layout/nav-items.ts`, so a new section is a line there
plus a route — not an edit to the Sidebar.

---

## Not in scope

Deliberately absent, and not to be scaffolded ahead of time: menu and pricing, the POS
terminal, orders and payments, reports and analytics, **inventory in every form** (stock,
recipes, ingredients, suppliers, purchasing), an in-app user-management screen, shift and
cash-drawer handling, offline/PWA support, multi-outlet tenancy, audit logging, printer
integration, and deployment/CI. Each arrives in the phase that calls for it.
