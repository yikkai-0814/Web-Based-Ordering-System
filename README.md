# Web-Based Ordering System

A café / food-vendor point-of-sale and sales management system, built one phase at a time.

**Phase 1 (this code) is the foundation only:** tooling, styling, Firebase configuration,
the emulator suite, email/password authentication, Admin/Staff roles, Firestore security
rules, protected routing, and a role-aware layout.

No café domain functionality exists yet — no menu, no cart, no orders, no payments, no
reports. The dashboard and admin pages are deliberate placeholders whose purpose is to
prove that access control works end to end.

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
│  └─ auth/                    AuthProvider, useAuth, RequireAuth, RequireRole, LoginPage
├─ lib/                        firebase, env, auth-errors, utils
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
