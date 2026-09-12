# Web-Based Ordering System

A café / food-vendor point-of-sale and sales management system, built one phase at a time.

**Phase 1** built the foundation: tooling, styling, Firebase configuration, the emulator
suite, email/password authentication, Admin/Staff roles, Firestore security rules,
protected routing, and a role-aware layout.

**Phase 2** added the menu catalog: categories and priced items, managed by an admin and
read by staff, with costs visible to admins only.

**Phase 3** added the till: a touch-operated terminal, a cart, and an immutable order with
a daily number and snapshotted line items.

**Phase 4** added voiding: a completed sale can be cancelled with a stated reason, without
altering the sale itself (Phase 11 later let staff start one, with a manager approving).

**Phase 5** added reports: an admin-only view of revenue, item performance, payment mix,
voids, and estimated cost and profit resolved from the cost-history journal.

**Phase 6** added staff identities: named till operators without Firebase accounts, selected
on the shared POS and recorded on every order; and two independent order statuses —
fulfilment (pending → preparing → ready → delivered) and payment (unpaid → paid) — with an
order counting as complete only once both are finished.

**Phase 7** added order types: every order is dine-in or takeaway, and a dine-in order carries
the table it belongs to.

**Phase 8** turned the orders list into a workspace and gave the kitchen a board: one
business date at a time rather than the whole sales history, filters for the questions a
counter actually asks, search within the loaded day, and a live fulfilment queue where an
order is moved along one step at a time.

**Phase 9** makes the landing page answer for itself: a live "today at a glance" dashboard —
orders taken, money still to collect, and how deep the kitchen queue is, with revenue and
estimated profit for an admin only. It stores nothing new; every figure is derived from the
same rows the Orders list and the Queue board already show. The same phase bounded the
report's reads, which had been downloading every payment and void ever recorded on each load.

**Phase 10** adds no feature at all. It finishes the boundary every earlier phase relied on:
each collection now states the exact set of keys a write may carry, the Firebase account
named on an order, payment, fulfilment step or void is checked against the profile it claims
to be, a business date has to be a date, cost history has to point at a real item, and a menu
item can no longer be deleted out from under its cost. Alongside it, a third test suite
exercises the app's own write functions against the emulators, so a rule and the code that
writes for it can no longer drift apart unnoticed.

**Phase 11** lets staff void a sale without giving staff the power to void a sale. The
operator picks the sale and gives the reason; a manager then authorises it with their own
credentials, which sign in on a second, in-memory Auth session lasting exactly one write. The
void is therefore written with an admin's token — `allow create: if isAdmin()` never had to
change — and records both people: who authorised it, and who asked for it.

Still to come — no partial refunds, no tax or discounts. The admin page remains a deliberate
placeholder that proves access control works end to end.

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

| Script                     | What it does                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`              | Vite dev server                                                          |
| `npm run build`            | Typecheck, then production build to `dist/`                              |
| `npm run preview`          | Serve the production build locally                                       |
| `npm run typecheck`        | TypeScript only, no emit                                                 |
| `npm run lint`             | oxlint                                                                   |
| `npm run format`           | Prettier, writing changes                                                |
| `npm run emulators`        | Start the Firebase Emulator Suite                                        |
| `npm test`                 | All three suites: unit, then rules, then integration                     |
| `npm run test:unit`        | Pure-logic tests (money and cart arithmetic). No emulator needed         |
| `npm run test:rules`       | Start the Firestore emulator and run the security-rules tests against it |
| `npm run test:integration` | Start the Firestore **and Auth** emulators and drive the real write APIs |

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

### Every write states its exact key set

A rule that validates the fields it names still accepts the fields it does not. Until Phase
10 none of them used `hasOnly()`, so a client calling Firestore directly could attach
`discount`, `paid`, `refunded` or anything else to a new order, payment, fulfilment record or
void. Nothing read those fields — which is exactly the danger. The first feature to read one
would be reading a value a client invented, sitting in documents that are immutable and can
never be cleaned up.

So `hasFields(required, optional)` is applied to every validated write, and the key set for
each collection is taken from the function that writes it: `createOrder` for `orders`,
`recordPayment` for `orderPayments`, `writeTransition` for fulfilment and its journal,
`voidOrder` for `orderVoids`, `menu-api.ts` for the catalog, `staff-api.ts` for the roster.
Two details matter when changing one:

- **An update is checked against the merged document, not the delta.** So the list for a
  collection the app edits with `updateDoc` — categories, menu items, costs, staff members —
  must name every key the document has ever carried, `createdAt` included.
- **Optional means optional.** `orders` has exactly one optional key, `tableNumber`, and
  `validService` still decides which order type may carry it. `orderPayments` has none: an
  e-wallet payment writes `cashTendered` and `changeGiven` as `null` rather than omitting
  them, so they are required, not optional.

### Both identities on a record are now verified

Every order, payment, fulfilment step and void names two identities: the POS operator, and
the signed-in Firebase account. The operator half has been verified since Phase 6 by
`validOperator` — the id must be the caller's own account or a roster member who exists, is
active, and whose current name matches. The account half was only ever checked as
`is string`, so any signed-in user could stamp an arbitrary name onto the account that rang
a sale up, took the money, moved the order or cancelled it. `accountNameMatches` now
compares it with the `displayName` on the profile that uid belongs to. It costs nothing:
`profile()` is already fetched by `isActive()` on every one of those paths, and rules cache
a `get()` per path.

### Smaller guarantees closed in the same pass

- **`businessDate` must be a date**, `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, on an order and on the
  `counters/{businessDate}` document id. The old check was "a string of length 10", which
  `xxxxxxxxxx` passes — and an order filed under a day nothing queries cannot be corrected
  afterwards, orders being immutable.
- **A cost-history entry must name a real menu item.** Reporting resolves an order line's
  historical cost by `itemId`, so an entry against an id nothing has is a cost that silently
  applies to nothing — in an append-only journal, permanently.
- **A menu item cannot be deleted without its cost.** `deleteMenuItem()` has always batched
  both; now `!existsAfter(...)` on the cost makes skipping it impossible, rather than merely
  unlikely.

### What the rules cannot enforce

One gap is left open, deliberately and in the open: **`total` is not verified against
`lines`, and the lines are not shape-checked individually.**

Rules have no iteration. Summing a list would mean unrolling a fixed maximum number of
lines, and `MAX_CART_LINES` is 100; checking each line's `unitPrice` against the live menu
would need one `get()` per line against a hard limit of ten document accesses per request.
Neither is viable. The honest fix is to move order creation behind a server-side write,
which means Cloud Functions and the Blaze plan — outside this project's stated constraints.

So state the residual risk plainly rather than implying it away: **an active staff account
calling Firestore directly can write an order whose `total` disagrees with its own lines**,
and the payment, void and reporting layers all trust `order.total`. `validateCart` and
`cartTotal` in `src/features/pos/cart.ts` guard the app's own path, but a client-side check
is not a control.

What the rules do guarantee about a sale: it is immutable once written, it carries exactly
the keys the till writes and no others, every scalar is the right type and in range, the
business date is a date, it is attributed to the calling account under that account's own
name and to an operator who is real and active, and it claims nothing about having been
paid.

### Three test suites, and what each one is for

| Suite               | Needs                            | Answers                                                                |
| ------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `tests/unit`        | nothing                          | Is the pure logic right — money, cart, status resolution, aggregation? |
| `tests/rules`       | Firestore emulator               | Would the database accept this document from this caller?              |
| `tests/integration` | Firestore **and** Auth emulators | Is this the document the app actually sends?                           |

The third exists because the first two can both be green while disagreeing. The rules suites
hand-build the documents they submit, so a rename inside `fulfillment-api.ts` would break the
app without breaking a single test. `tests/integration` signs a real account in against the
Auth emulator and calls `createOrder`, `recordPayment`, `setFulfillment`, `voidOrder`,
`updateMenuItem` and the rest, under the real rules, then reads back what landed.

Its accounts are created under a unique prefix each run and never deleted — the Auth emulator
resolves a request's project from its API key rather than from the configured project id, so
"clear the accounts for this project" is not reliably scoped, and wiping it would throw away
whatever the developer had created in their own emulator. Firestore is cleared between tests,
scoped to the suite's own `demo-` project id. The Firebase config the suite uses is fixed in
`vitest.config.ts` and obviously fake, so the suite tests the same thing on every machine and
can never reach a real project.

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
orders/{orderId}     number, businessDate, lines[], total (sen), createdAt,
                     createdBy, createdByName, staffId, staffName,
                     orderType ('dine_in' | 'takeaway'),
                     tableNumber                    ← dine-in ONLY; absent for takeaway
                                                    ← IMMUTABLE, and carries NO payment
orderPayments/{orderId}
                     orderId, method ('cash' | 'ewallet'), amount (sen),
                     cashTendered, changeGiven, paidAt,
                     paidBy, paidByName, paidByStaffId, paidByStaffName
                                                    ← append-only, one per order
orderFulfillment/{orderId}
                     orderId, status ('pending' | 'preparing' | 'ready' |
                     'delivered'), updatedAt, updatedBy, updatedByName,
                     updatedByStaffId, updatedByStaffName
                                                    ← forward-only; ABSENT means pending
orderFulfillment/{orderId}/transitions/{autoId}
                     orderId, from, to, at, updatedBy, updatedByName,
                     updatedByStaffId, updatedByStaffName
                                                    ← append-only journal, one per step
counters/{businessDate}
                     lastNumber                     ← issues the daily order number
orderVoids/{orderId} orderId, reason, amount (sen), voidedAt, voidedBy, voidedByName,
                     initiatedByStaffId, initiatedByStaffName
                                                    ← ADMIN-AUTHORISED, append-only
staffMembers/{id}    name, active, createdAt, updatedAt
                                                    ← ADMIN-WRITE, NO DELETE
```

### Staff identities and who took an order

A food stall shares one device and one login across a shift, so the Firebase account cannot
say who rang a sale up. Two separate things are therefore recorded on every order:

| Field                         | Meaning                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createdBy` / `createdByName` | the **signed-in Firebase account** — which credential was used. Still `== request.auth.uid`, unchanged since Phase 3 |
| `staffId` / `staffName`       | the **person operating the till**, and their name snapshotted at the moment of sale                                  |

`staffMembers` are **not** login accounts and carry no permissions. The signed-in Firebase
role remains the only authorisation boundary: selecting an operator grants nothing. Henry
needs no second account — his admin login is the credential, and he selects a staff identity
named "Henry" when he takes orders.

The till shows a picker before anything can be added to a cart, and the current operator sits
in the topbar with one-tap switching — no Firebase login or logout involved.

**The signed-in account is always an available operator**, listed first and marked "This
account". Named identities are an _addition_, not a prerequisite: a staff-role user cannot
create staff identities, so if the roster were the only source of operators, an empty or
fully-deactivated one would leave the counter unable to sell with no way to recover. Selling
is the one capability the till must never lose. An order attributed this way carries the
account's own uid and display name — exactly the attribution orders had before staff
identities existed.

**The rules verify attribution at write time.** An order's operator must be either the
signed-in account itself (`staffId == request.auth.uid` and `staffName` equal to that
account's display name) or a named staff member who exists, is `active`, and whose
**current** name equals `staffName`. Self-attribution is verified too — it is not a hole to
write an arbitrary name through. Combined with order
immutability, that gives both halves of what history needs — the snapshot was provably
accurate when taken, and a later rename cannot rewrite it. Renaming Alice to Alicia leaves
yesterday's orders reading Alice.

**There is no deletion.** Retiring someone is deactivation: they drop out of the picker while
every order they rang up keeps their name. A record that history points at should not be
removable by accident.

Orders written before Phase 6 have no `staffId`. They are not backfilled — orders are
immutable — so `operatorNameOf()` falls back to the account name. That fallback is permanent,
not transitional.

### Why a manager signs in instead of typing a PIN

The obvious way to let staff void a sale is a manager's PIN. We evaluated one, twice, and
built something else both times — the reasoning is kept here because it is the reason the
current design looks the way it does.

Firestore rules _can_ check a secret without exposing it, since rules `get()` ignores the
caller's read permission — so no plaintext and no readable hash. Three things still defeat
a PIN:

1. **Rules cannot rate-limit.** A lockout counter is itself attacker-writable and racy, so a
   4-digit PIN's 10,000 candidates fall in minutes.
2. **The submitted PIN would have to be stored.** Rules only see the document being written,
   so the value has to travel inside the void — and staff can read voids. A hash is no
   better: four digits of sha256 fall in under a second offline, from a document the
   attacker is allowed to read.
3. **It could not be an authorisation boundary anyway.** Every operator authenticates as the
   _same shared account_, so the rules cannot tell one person's browser from another's. A
   PIN would gate a screen, not a permission.

A gate that does not gate is the security theatre this project rejects, and worse, someone
might rely on it in a dispute about takings. Real PIN security needs a server to hold the
secret and throttle attempts — which on this stack means Cloud Functions and the Blaze plan.

**So the manager's own credentials are the secret, and Firebase Auth is the server.** It
already holds passwords hashed, already throttles guessing (`auth/too-many-requests` is
handled and shown as such), and already issues exactly the thing the rules need: a token
that proves the holder is an admin. The app signs the manager in on a _second_ Firebase app
(`src/lib/authorizer.ts`) with `inMemoryPersistence`, uses that session's Firestore handle
for the one write, and signs it out in a `finally`. The till's session is never touched, and
`allow create: if isAdmin()` did not have to change to accommodate any of it.

That is the test of the design: **a staff member who tampers with the frontend gains
nothing**, because the missing ingredient is not a check in the JavaScript but an admin's
token, which only admin credentials produce.

What it costs, stated plainly:

- **It is a password, not four digits.** Slower at a busy till, and unpleasant to type on a
  phone-sized screen. That is the price of it being real.
- **A manager who shares their password hands over full admin** — worse than a leaked PIN
  would have been. The mitigation is procedural: managers type it themselves.
- **Nothing proves who typed it.** The void records the manager as authoriser and the
  operator as initiator, but a manager who walks away from an unlocked till has authorised
  whatever happens next.
- **The initiator is attested, not proven.** The rules check that the named initiator is a
  real, active identity with that name; they cannot check that person was standing there.

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
types and ranges, that the sale is attributed to the caller, that the order claims nothing
about having been paid, and — on a payment — the method enum, that `amount` equals the
order's own total, and that `changeGiven` is exactly `cashTendered - amount`. The cart
arithmetic itself is guarded by the pure functions in `src/features/pos/cart.ts` and their
unit tests. Closing that last gap would need a Cloud Function.

### Payment methods

Two, and only two: **Cash** and **E-Wallet**. The `ewallet` value covers every cashless
method the vendor accepts — DuitNow QR and the various wallet apps are one thing at the
counter, so they are one value rather than a distinction nobody makes.

**E-Wallet is recorded, not integrated.** Choosing it labels the sale and nothing more —
there is no payment gateway, and the system never learns whether the transfer actually
succeeded. The person at the till confirms that on the customer's phone, exactly as they
would without this system. Only cash has arithmetic behind it: amount tendered, and change
due computed to the sen.

The enum lives in `src/features/pos/types.ts` and is mirrored in `firestore.rules`. Adding a
method later is safe. Renaming or removing one strands past payments that still carry the old
value: `parseOrderPayment` rejects them, and the order reverts to reading as unpaid. Change
the enum only while the data is disposable.

### Paying an order

Placing an order and paying for it are **two separate actions**, because at a stall they are
two separate moments — the customer orders, the drink is made, and they pay when they
collect. An order is therefore created `UNPAID`, and stays that way until somebody records
payment against it from the order's own page.

Payment is **not a field on the order**. It is its own document, `orderPayments/{orderId}`,
for the same reason a void is:

- Orders are immutable. Marking one paid would mean granting update permission, which would
  reopen every field on every sale to whoever works the till.
- Keying by the order id makes paying twice impossible — the second write is an update, and
  updates are denied. That property is bought by the data model, not by a check someone
  remembered to write.
- A payment cannot be edited or withdrawn, so the record of money taken cannot be quietly
  rewritten.

The rules refuse a payment when the order does not exist, has been voided, is already paid,
uses a method the café does not take, or carries figures that do not add up. They also refuse
any _order_ that arrives carrying `paymentMethod`, `cashTendered` or `changeGiven` — which is
what stops a client minting a sale that is paid on arrival and never appears as outstanding.

**A paid order can still be voided**, and voiding is unchanged: no refund is issued or
recorded anywhere, because there is no payment gateway to refund through. The void is the
counter-entry, and the payment record survives it as a statement of what happened.

Only cash has arithmetic: `changeDue` in `src/features/pos/cart.ts` computes change in whole
sen and refuses an under-payment, and the rules recompute it independently.

**A payment names two identities, exactly as an order does.** One shared login serves the
whole shift, so the account alone cannot say who was at the counter — and accountability for
money is the last place to drop that distinction:

| Field                               | Meaning                                           |
| ----------------------------------- | ------------------------------------------------- |
| `paidBy` / `paidByName`             | the signed-in Firebase account — which credential |
| `paidByStaffId` / `paidByStaffName` | the POS operator who took the money               |

The rules validate the payment's operator with `validOperator`, **the same function order
creation uses** — the identity must either be the signed-in account itself, or a roster
member who exists, is active, and whose _current_ name matches what is being stored. A
deactivated member is refused, and a payment cannot be pinned on a colleague by sending their
name. Because payments are immutable, that snapshot cannot be rewritten by a later rename.

The self-operator form is always available to everybody, which is what lets an **admin settle
an order without selecting an operator first** — payment never waits on a roster step. The
same order may be placed by one operator and paid by another; both are recorded, and neither
overwrites the other.

**Orders written before this existed** carry `paymentMethod` inline and have always meant
paid. `resolvePaymentState` in `src/features/pos/payments.ts` reads them as paid and marks
them `source: 'legacy'`, so old receipts still display correctly with **no data migration**
and no backfill of immutable documents. Those orders cannot be paid again through the new
flow — the rules refuse it.

### Order type and table number

Every order records how it is served:

```
orderType:    dine_in | takeaway
tableNumber:  required for dine_in, ABSENT for takeaway
```

A table number is **only an identifier stamped on the order**. Several orders may carry the
same one, and nothing in this system tracks which tables are occupied, free, or owe money.
There are deliberately no table tabs, no grouping, no availability, no transfers, no merging,
no floor plan and no reservations — a café writes "5" on a docket so the food reaches the
right table, and that is the whole of it.

`tableNumber` is short free text matching `^[A-Za-z0-9]{1,8}$`, so `5`, `12`, `A3`, `T12` and
`12B` all work — a café labels its tables however it likes. It is stored **trimmed**.

**The invariant is enforced at the database**, in `validService`:

- `orderType` must be one of the two values;
- `dine_in` must carry a `tableNumber` matching the pattern;
- `takeaway` must **not carry the key at all** — absent, not null, for the same reason
  `carriesNoPayment` refuses a null `paymentMethod`. Present-but-empty is a third state
  nothing could classify.

Two details in that rule are load-bearing. It is written as a ternary because reading a
missing field in Firestore rules is an **evaluation error, not null**, so `d.tableNumber` must
only be reachable on the branch where it is guaranteed to exist. And it uses `matches()`
rather than a length check because rules have no `trim()` — `size() > 0` would happily accept
`"   "` from a client that skipped the form. The pattern is mirrored in
`src/features/pos/order-type.ts`; keep the two in step.

Both fields are written once, with the order. Orders are immutable, so **a mistyped table
number is corrected the way any other mistake on a sale is: void it and ring it again.**

**The till defaults to dine-in** rather than takeaway, deliberately. A dine-in order cannot be
placed until somebody types a table number, so a forgotten toggle _blocks_; defaulting to
takeaway would let a mis-set order sail through and be silently mis-recorded. Both fields
reset after every order for the same reason — carrying "Table 5" into the next customer's
order would be invisible, because the field looks identical either way.

**Orders placed before Phase 7** have neither field. `parseOrder` reads both as `null` exactly
as it does `staffId`/`staffName`, and `orderTypeSummaryOf` renders them as **"Not recorded"**.
No backfill, no migration, and no guessing: those orders genuinely did not capture this, and
inventing a type would be inventing history.

### Fulfilment and payment are two separate things

An order has **two independent statuses**, and there is deliberately no single `status` field
anywhere in the system:

```
fulfilment:  pending → preparing → ready → delivered
payment:     unpaid  → paid
```

They move independently because at a stall they genuinely do. A customer may pay while the
drink is still being made, or take the food and pay on the way out. Collapsing the two into
one field would make half of the real states unrepresentable — and the state this design
exists to expose, _delivered but unpaid_, is precisely the one that a single field tends to
lose.

**"Completed" is derived, never stored:**

| Fulfilment | Payment | Overall             |
| ---------- | ------- | ------------------- |
| Pending    | Unpaid  | Pending             |
| Preparing  | Unpaid  | Preparing           |
| Ready      | Unpaid  | Ready               |
| Delivered  | Unpaid  | Payment outstanding |
| Preparing  | Paid    | Preparing           |
| Ready      | Paid    | Ready               |
| Delivered  | Paid    | **Completed**       |

Fulfilment leads until it is finished, because a paid order that is still being made is, to
everyone involved, still being made. A voided order reports as Voided whatever the two axes
say. `overallStatusOf` in `src/features/pos/fulfillment.ts` is the only place this is
decided; storing it would be a third piece of state that could contradict the two it comes
from.

`delivered` is the single final state for both dine-in and takeaway. There is no separate
`collected` status: the system does not record how an order is served, so a second terminal
state would be a distinction nothing could set.

#### How fulfilment moves without making orders mutable

Fulfilment lives in `orderFulfillment/{orderId}` — its own document, like a void and a
payment, so `orders` keeps `allow update, delete: if false` untouched. It is the first
sidecar that may be **updated**, because fulfilment is the one thing about an order that
legitimately progresses. The rules make that safe by validating the _transition_ rather than
the value:

- **`pending` is the absence of the document.** A newly placed order needs no write at all,
  and cannot be born part-way through the workflow.
- **Create is legal only into `preparing`** — the single step out of pending.
- **Update may move exactly one place forward.** Skipping is refused, so no client can jump an
  order to `delivered`; backward is refused outright for staff.
- **An admin may step exactly one place back**, to correct a mis-tap. Without it the forward
  path is a one-way door and a fat-fingered "Mark delivered" is unfixable. It stays with
  admins for the same reason voiding does: the person undoing the mistake should not be the
  person who made it.
- **A voided order stops.** Neither role may start or continue it through the kitchen.

The fulfilment rules never consult the payment document, and the payment rules never consult
fulfilment. The two axes are genuinely independent all the way down to the database.

#### Who moved it

Every fulfilment step names **two identities**, exactly as an order and a payment do —
`updatedBy` / `updatedByName` for the signed-in Firebase account, and `updatedByStaffId` /
`updatedByStaffName` for the POS operator who made the move. The rules validate the operator
with `validOperator`, **the same function order creation and payment use**, so all three are
judged by one definition and cannot drift apart.

The parent document holds only the _current_ status and whoever moved it last, so on its own
it cannot answer "who started preparing this" once somebody else has marked it ready. Each
step is therefore also appended to `orderFulfillment/{orderId}/transitions`, which is never
updated or deleted — the same shape as `menuItemCosts` (current value) alongside
`menuItemCostHistory` (append-only journal), and written in the **same batch** by
`fulfillment-api.ts` so the two cannot disagree. An admin rollback is journalled like any
other step rather than quietly rewinding.

`getAfter` in the journal's rule ties each entry's `to` to the status the parent actually
ends up at, which is what stops the trail describing a move that did not happen. As with menu
item costs, rules cannot _require_ a companion write, so the pairing is enforced by funnelling
every transition through `fulfillment-api.ts`; the journal being append-only means a missing
entry can never be disguised, only noticed.

**Legacy orders** carry inline payment and have no fulfilment record.
`resolveFulfillmentState` reads them as `delivered`: they were rung up and handed over in one
motion, so reading them as `pending` would be false and would leave every historical sale
sitting in a queue of work nobody is going to do. As with payment, there is no migration and
no backfill.

### Voiding a sale

A mistake is corrected by **voiding**, never by editing. A void carries a required reason;
the order document is not touched at all.

**Staff start a void; a manager finishes it.** A staff member picks the sale, gives the
reason, and is then asked for a manager's credentials. Those credentials sign in on a
separate, in-memory Auth session that exists for the length of one write and is discarded —
so the void arrives carrying an _admin's_ token while the till stays signed in as itself. An
admin voiding their own sale is never asked for anything. See "Why a manager signs in"
below for why it works this way.

The void is its own document at `orderVoids/{orderId}`, keyed by the order it cancels,
because orders are immutable — marking one would mean granting update permission, which
would reopen every field on every sale to whoever can void. Two properties fall out of that
design for free:

- **The same order cannot be voided twice.** The second write is an update to an existing
  document, and updates are denied.
- **A void cannot be edited or withdrawn.** There is no un-voiding; reversing a correction
  would destroy the audit trail that is the point of recording it.

**A void names two people, and the difference matters.** `voidedBy`/`voidedByName` is who
_authorised_ it — always an admin, because the rules accept the write from nobody else.
`initiatedByStaffId`/`initiatedByStaffName` is who _asked_ for it: the operator at the till.
On an admin's own void both are the same person. Keeping them apart is what makes the record
answer "who cancelled this sale" honestly when a manager approved something a staff member
requested. The rules verify the initiator the only way they can — it must be a real, still
active identity, roster member or account, whose _current_ name matches what was written —
which stops a name being invented, though not a manager attributing a void to the wrong
colleague. Voids written before Phase 11 carry no initiator and are never backfilled, voids
being immutable; those display the authoriser for both.

Staff **read** voids. A till operator has to know a sale was cancelled, or the orders list
would misrepresent the day to the person working it. `amount` duplicates the order's total,
which is safe because orders are immutable and the rules enforce the equality with a
`get()` on the order.

A voided sale **keeps its order number** and stays in the day's sequence. A gap in the
numbering would look like a deleted record, which is exactly what a till audit is trying to
rule out.

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

## The orders workspace

Two screens read the same day through the same subscriptions: **Orders**, the record, and
**Queue**, the board. Neither can show a different answer for the same order, because both
resolve their rows with `buildOrderViews` from one shared hook, `useOrdersWorkspace`.

### One business date at a time

The date is the **query**, not a filter applied after the fact:

```ts
query(collection(db, 'orders'), where('businessDate', '==', businessDate))
```

Orders are the one collection here that grows without limit, and both screens only ever show
a single day. Before Phase 8 the list subscribed to the whole collection and the receipt page
loaded every order ever written in order to find one — which got slower with every sale the
café made. A receipt is now four single-document listeners (`useOrderDetail`), and the
workspace is one day.

`businessDate` is `YYYY-MM-DD` and compared for equality, which the automatic single-field
index serves. Sorting is done in memory rather than with `orderBy('number')`, because an
equality filter plus a sort on a different field is exactly what would demand a composite
index — and a day's orders are few enough that sorting them costs nothing. **No index was
added; `firestore.indexes.json` stays empty.**

### How the sidecars are scoped

`orderPayments`, `orderFulfillment` and `orderVoids` are keyed by the order id and carry no
business date of their own. That is deliberate: a payment answers "was this order settled",
not "which day's takings does it belong to", and the day is already on the order it points
at. Adding a date to them would duplicate a fact that can disagree with itself — and could
not be applied to what already exists, since payments and voids are immutable and can never
be backfilled.

So the sidecars are fetched **by the ids of the orders already loaded**:

```ts
query(collection(db, path), where('orderId', 'in', chunk))
```

Firestore caps a disjunction at 30 values, so the ids are split into chunks and one listener
is opened per chunk. The chunks are cut on the **order number** (1–30, 31–60, …), not by
sorting and slicing the ids: numbers are assigned in sequence within a day and never change,
so each chunk freezes the moment it fills. A new sale only ever joins the last one, and every
earlier listener survives untouched — which matters, because the alternative resubscribes
every listener on the busiest screen in the café each time somebody rings something up. See
`src/features/pos/order-sidecars.ts`.

Reads scale with the day, not the history: roughly one order document per sale, plus at most
one payment, one fulfilment record and one void each.

### Filters

Ten of them — All, Unpaid, Paid, Pending, Preparing, Ready, Delivered, Completed, Dine-in,
Takeaway — all evaluated against the **derived** state by `resolvePaymentState`,
`resolveFulfillmentState` and `overallStatusOf`. There is still no stored overall status
anywhere in this system, and Phase 8 did not add one; a filter therefore cannot disagree with
the badge on the row it selected.

Two rules are worth stating outright:

- **A voided sale appears under All and nowhere else.** It is cancelled — not waiting to be
  paid, not queued in the kitchen, not completed. Listing one under "Unpaid" would send
  somebody chasing money for a sale that no longer exists.
- **An order placed before order types existed matches neither Dine-in nor Takeaway.** It
  genuinely did not record one, and guessing would invent history. All still shows it.

Legacy orders that carry payment inline are read as delivered and paid throughout, exactly as
the receipt reads them, so they sit under Paid, Delivered and Completed rather than clogging
the pending filter.

### Search

Client-side, over the **loaded business date only**, matching the order number (a leading `#`
is ignored), the table number, and any item name on the order. Deliberately local: Firestore
cannot search substrings, and a global search would mean loading the whole history or bolting
on a search service — neither of which "which one was the flat white for table 5" needs.

### The fulfilment queue

`/queue` shows Pending, Preparing and Ready as three columns, **oldest first** within each —
the opposite of the Orders list, because a kitchen works in the order the orders arrived
while a record is read from the top. Each card carries the order number, how it is served and
the table where there is one, the items and their quantities, the total, both status badges,
and who took the order and who moved it last.

The button on a card comes from `queueActionFor`, which is `canAdvanceFulfillment` plus
`FULFILLMENT_ACTIONS`, and the write goes through the same `setFulfillment` the receipt calls
— parent document and journal entry in one batch, as always. **There is no second workflow
here, only a second arrangement of the first.** An invalid step is refused three times over:
the button never renders, `setFulfillment` throws before writing, and the security rules
refuse the write regardless of what the client believes.

Delivered and voided orders leave the board — a queue that accumulated every finished order
all day would bury the three that still need doing — and remain in the Orders workspace under
All, Delivered and Completed.

Payment is shown on a card but never taken there. An unpaid order is the one thing on the
board somebody has to act on, so hiding it would be wrong; taking the money is the counter's
job on the receipt, not the kitchen's.

---

## Reports

`/reports` is **admin only**, at the route, in the navigation, and — the part that matters
— at the database. It shows cost, estimated profit and margin, which staff must never see.

Reporting adds **no collection and no security rule**. It is read-only aggregation over
data the reader already has permission to see, so it cannot weaken the immutable-order or
void models. The protection is the one already built: `menuItemCosts` and
`menuItemCostHistory` are admin-only, so a staff session cannot obtain cost data even by
calling the reporting code directly. `tests/rules/reporting.rules.test.ts` pins that.

### How the figures are computed

**Revenue** is the sum of `total` over non-voided orders in range, **paid or not**, and
regardless of how far through the kitchen they are. There is no tax, service charge or
discount, so an order's total _is_ its revenue.

Reporting deliberately ignores fulfilment entirely: a sale is counted when it is rung up, and
whether the drink has been handed over is an operational question, not an accounting one.

That an order is counted when it is rung up rather than when it is settled is deliberate, and
it is why introducing pay-later did not restate a single past figure: revenue, cost, profit
and margin all mean exactly what they meant before. What has actually been received is a
different question, answered separately by **Collected** and **Outstanding**, which always
sum to revenue. An order is never treated as paid merely because it exists.

The **payment-method breakdown counts paid orders only** — an unpaid order has no method to
attribute, and putting money that has not arrived beside money that has would make the table
answer neither question.

**Voided orders are removed once**, before anything is counted, so they are absent from
revenue, order count, average order value, payment mix, outstanding money and item
performance alike — a voided unpaid order is not owed by anyone. They
appear only in the Voids section. Filtering in one place is what stops a cancelled sale
leaking into a total somebody forgot to guard.

**Historical cost** is resolved per line, at the moment of the sale (`createdAt`, not the
business date, so two sales either side of a midday change differ):

| Situation                               | Result                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Entries exist at or before the sale     | the newest such entry's cost                                                               |
| ...and that entry **cleared** the cost  | **unknown** — a clearing is a real event, so falling back would resurrect a removed figure |
| No history at all for the item          | the current cost, which has applied for all time                                           |
| History exists but every entry is later | **unknown** — a later figure would be a guess presented as fact                            |
| Order has no timestamp                  | **unknown**                                                                                |

Resolution keys on `menuItemId`, so renaming or repricing an item afterwards changes
nothing; revenue always uses the price snapshotted on the order line.

### Estimated, not actual

```
estimatedCost   = Σ (unit cost in force × quantity)   over lines with a KNOWN cost
estimatedProfit = revenue − estimatedCost
costCoverage %  = revenue from known-cost lines ÷ total revenue
```

Lines with no recorded cost contribute **nothing** to estimated cost, which means profit and
margin are an **upper bound** whenever coverage is below 100%. The page says so: the tiles
are relabelled "(incomplete)" and a warning states what share of revenue has a recorded
cost. An estimate must never be read as an actual figure.

### Queries and performance

Reports use one-shot `getDocs`, not the live `onSnapshot` subscriptions the rest of the app
uses — a report is a point-in-time answer, and holding listeners over thousands of orders
costs reads for no benefit.

Orders are fetched with a `businessDate` range filter. That field is `YYYY-MM-DD`, so
lexicographic order is chronological order and the automatic single-field index serves it —
**`firestore.indexes.json` stays empty**.

**Payments and voids are fetched by order id, not read whole.** They used to be read whole,
on the reasoning that both are small. That is true of voids and was false of payments: there
is one `orderPayments` document per paid order, so the collection grows exactly as fast as
`orders`, and a report on a single day was downloading every payment the café had ever
taken — a cost that only ever increased. Neither record carries a `businessDate`, and adding
one is the wrong fix: the day a payment belongs to is already on the order it points at,
duplicating it would create a fact that can disagree with itself, and it could never be
backfilled onto records that are immutable by design.

So reports reuse what the orders workspace already does. The orders come back first, and
their ids are then chunked thirty at a time into `where('orderId', 'in', [...])` queries via
the same `chunkOrderIds` helper — see `src/features/pos/order-sidecars.ts` for the full
reasoning. `in` on a single field is served by the automatic index, so there is still no
composite index to deploy, and no document shape or security rule changed. The cost is one
extra round trip, because the ids are not known until the orders arrive.

Current costs and cost history are still read whole, and legitimately: both are bounded by
the size of the menu, not by how much the café sells.

Reads now scale with the range and nothing else: a month at 150 orders/day is roughly 4,500
orders plus at most that many payments. A large range does issue many small chunk queries —
a year is some 1,800 per sidecar collection — so they run through a bounded-concurrency
window rather than all at once. Custom ranges are capped at 366 days. If that ever becomes
expensive, pre-aggregated daily rollups are the answer — deliberately not built now.

---

## The dashboard

The landing page for both roles, and the only screen that is fixed to **today**: the date
comes from `businessDateOf(new Date())`, the same helper the till files orders under. Looking
at another day is what the Orders and Queue screens are for.

**It stores nothing and computes nothing twice.** The rows come from `useOrdersWorkspace` —
the same live subscription set the Orders list and the Queue board use — and
`buildDashboard` in `src/features/dashboard/summary.ts` reads the figures off fields those
rows have already resolved. Queue depth goes through the board's own `isQueued` and
`QUEUE_COLUMNS`. There is deliberately no persisted aggregate and no stored dashboard
status: a third copy of a fact is a third thing that can fall out of step with the two it
came from. A voided sale is excluded from every figure, exactly as it is on the Orders list.

**Role awareness is in what it fetches, not only in what it shows.** `buildDashboard`
returns `finance: null` for a staff member — the money section is absent from the data, not
hidden in the markup, so no component can render it by accident and a test can assert its
absence directly.

Be precise about what that is, though. Orders carry `total` and staff can read orders; the
till shows totals all day. Keeping revenue to admins is a presentation decision matching
Reports being admin-only, **not** a security boundary. The real boundary is cost, which lives
in admin-only collections — so the estimated cost and profit card is a separate component
mounted only for an admin, and a staff session never issues that read at all. It reuses
`useReport` for the `today` preset rather than recomputing anything, and says plainly that it
is a snapshot taken on load while the tiles above it are live.

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
│  ├─ dashboard/               today at a glance: pure summariser + the landing page
│  ├─ menu/                    catalog: hooks, write API, list/form/categories pages
│  ├─ pos/                     till: cart, order transaction, receipts, voids,
│  │                          date-scoped workspace, filters, fulfilment queue
│  ├─ staff/                   till operators: roster, session, picker
│  └─ reports/                 admin-only: aggregation, cost resolution, CSV export
├─ lib/                        firebase, env, auth-errors, money, utils
└─ pages/                      Admin, 403, 404 — the screens that are not a feature

tests/unit/                    pure logic; no emulator
tests/rules/                   Firestore security-rules tests
tests/integration/             the real write APIs, against both emulators
firestore.rules                The authorization boundary
```

Architecture is feature-first: cross-cutting code lives in `src/lib` and `src/components`,
and each domain gets its own `src/features/<domain>/`. Phase 1 creates exactly one feature
(`auth`), establishing the pattern without pre-building anything else. Navigation is
declared as data in `src/components/layout/nav-items.ts`, so a new section is a line there
plus a route — not an edit to the Sidebar.

---

## Not in scope

Deliberately absent, and not to be scaffolded ahead of time: partial and line-level
refunds, PINs and any client-side secret verification, payroll, attendance, shifts and
clock-in/out, per-staff sales reports, tax, service charge and discounts, charts and any
charting library, Excel and PDF
export, scheduled or emailed reports, pre-aggregated rollups, per-staff performance
reports, held or parked orders, table service, customer accounts, **inventory in every
form** (stock, recipes, ingredients, suppliers, purchasing), an in-app user-management
screen, shift and cash-drawer handling, offline/PWA support, multi-outlet tenancy, general
audit logging, receipt printing and printer integration, and deployment/CI. Each arrives in
the phase that calls for it.
