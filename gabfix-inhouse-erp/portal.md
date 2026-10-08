# Gabfix Portal — Design & Implementation Plan

Portal app: `gabfix-inhouse-erp/` (Vite + React 19 + TypeScript, strict).
Server: Express + PostgreSQL (`server/`) at repo root. Portal root route: `/` (custom-domain root).

## Why this document

`portal.md` was a Phase 1c _tracking_ note, not a spec; it recorded the jobs-assignments work but never
captured the portal's roles, navigation, board wiring, auth contract, or PWA/push surface. This file is the
spec + phased plan. It is the single source of truth for what "portal" means next.

---

## 1. Scope decisions (final)

All four scope questions from the continuation handoff were answered and are locked here.

1. **Portal URL = custom domain root `/`.** The portal entry is `/`; there is no `/portal` or `/employee`
   route anywhere. `src/App.tsx` already routes `Path="/"` → `ProtectedRoute` → `PortalPage`.
2. **All boards go live.** My day, My jobs, Schedule, Timesheets, Costs, Documents, My trail all render
   real live pages. The old `selectNav` toast is replaced by live components.
3. **Auth contract (explain).**
   - `POST /api/auth/login` — `identifier` = name **or** email; server bcrypt-compares `pin_hash` against the
     supplied password; succeeds with a valid account, 401 otherwise. No sign-up; staff are admin-created.
   - Returns `{ accessToken, refreshToken, user: { id, name, role, app_scope } }`.
   - `GET /api/auth/me` — fresh from the DB on every call (no client-side session inference).
   - Tokens: `{ gabfix:auth-token, gabfix:refresh-token }` in `localStorage`.
   - `ProtectedRoute` guards employee pages; `/auth/*` is publicly route-guarded.
   - Portal only needs `VITE_APP_ID=portal`; no new portal-specific auth routes.
   - Refresh: on 401, `GET /auth/refresh` exchanges the stored refresh token, retries the original request.
4. **Documents/Reports surface.** Reuse the existing `DocumentsPage`; it reads `GET /api/data` and downloads
   server PDFs via `GET /api/documents/:type/:id.pdf` (pdfkit, admin-only). "Reports" is not a separate page —
   `Documents & Reports` lives on the existing `DocumentsPage`.

---

## 2. Roles & navigation

The nav list (defined in `src/pages/index.tsx`) and what each board does with live data.

| Nav label  | Component (once wired)                    | Data source                              | Notes                                                                                                                                        |
| ---------- | ----------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| My day     | `PortalPage` shell                        | `useMyJobs(name, id)`                    | KPI strip + job list + right stack. `role` `<select>` previews Technician/Sales/Supervisor/Accountant-field/CSR. Lives now.                  |
| My jobs    | `PortalPage` job list                     | `useMyJobs` filtered by `assignedJobIds` | Exact `job_assignments` membership (migration 009). Technician sees only their jobs; Supervisor/Accountant/Sales pass through the live list. |
| Schedule   | `PortalPage` schedule panel (right-stack) | demo `demoJobs` live-only today          | Not yet a live server page; keep as a static preview until the server schedule endpoint exists.                                              |
| Timesheets | `TimesheetsPage`                          | `GET /api/employees/my-filings`          | Live. Filing via modal; admin approvals arrive over SSE.                                                                                     |
| Costs      | `CostsPage`                               | `GET /api/employees/my-filings`          | Live-only (no demo fallback).                                                                                                                |
| Documents  | `DocumentsPage`                           | `GET /api/data` + server PDF downloads   | Live.                                                                                                                                        |
| My trail   | `TrailPanel`                              | `useBeacon` GPS panel + outbox           | Lives now.                                                                                                                                   |

The nav list is a single source of truth for the label→component mapping. Adding a board means:

1. adding `{ label, icon }` to `nav`,
2. rendering a live component in the `switch`/`if` block instead of the toast.

---

## 3. Board wiring (`src/pages/index.tsx`)

The current gate is:

```ts
const selectNav = (label: string) => {
  setActive(label);
  setMobileNav(false);
  if (label !== "My day" && label !== "My trail") toast(`${label} is ready for backend connection`);
};
```

Replace it with a live-renderer. The cleanest minimal change is a small map from label → element:

```ts
const board = {
  "My day": null,
  "My jobs": null, // job list lives inside PortalPage; no extra shell needed
  Schedule: null,  // static preview until a server schedule endpoint exists
  Timesheets: <TimesheetsPage employeeId={session?.id ?? ""} />,
  Costs: <CostsPage employeeId={session?.id ?? ""} />,
  Documents: <DocumentsPage employeeId={session?.id ?? ""} />,
  "My trail": null,
};
```

then

```ts
const selectNav = (label: string) => {
  setActive(label);
  setMobileNav(false);
  if (board[label]) {
    // rendered next to the job list in the dashboard layout
  }
};
```

The timesheets/costs/documents pages take `employeeId` for the live employee-scoped reads.

**Implementation change (this phase):**

- Remove the toast for `Timesheets`, `Costs`, `Documents`.
- Render those three live pages inside the dashboard right-stack (or as a full-width panel when the screen
  allows), so the nav label no longer falls through to "ready for backend connection".
- `My day` and `My trail` keep rendering as today; `My jobs` reads from the live `useMyJobs` feed.

---

## 4. Live vs. static split

| Board      | Status         | Reason                                                               |
| ---------- | -------------- | -------------------------------------------------------------------- |
| My day     | Live           | Already live (KPI strip + job list + right stack).                   |
| My jobs    | Live           | Filtered from live `job_assignments`; no demo fallback.              |
| Schedule   | Static preview | No server schedule endpoint yet; the right-stack calendar is a demo. |
| Timesheets | Live           | `useMyFilings(employeeId)` reads the server; modal writes.           |
| Costs      | Live           | `useMyFilings(employeeId)` reads the server; modal writes.           |
| Documents  | Live           | `GET /api/data` + server PDF download.                               |
| My trail   | Live           | GPS beacon panel with offline outbox.                                |

Rules:

- A board earns its nav entry only when it renders a live component. The nav list doubles as the "live"
  checklist; no tag is needed anywhere else.
- Demo-only data is explicitly forbidden on live boards (Timesheets/Costs already scrub their demo fallback;
  Documents only renders after `GET /api/data` succeeds).

---

## 5. Auth contract (confirmed working contract)

- `POST /api/auth/login` with `{ identifier, password }`. Identifier is name **or** email. Server bcrypt
  compares `pin_hash`. Result: `{ accessToken, refreshToken, user }`.
- `GET /api/auth/me` — fresh from DB.
- Pairs stored in `localStorage`: `gabfix:auth-token`, `gabfix:refresh-token`.
- `GET /api/auth/refresh` — exchanges the refresh token; returns `null` when expired.
- `ProtectedRoute` guards `/`. `src/App.tsx` already has `/` protected and `/auth/*` public.
- Portal env: `VITE_APP_ID=portal`. No new portal auth route.

---

## 6. PWA and push surface

- `vite-plugin-pwa` with `generateSW`; service worker registered via `registerPortalServiceWorker`.
- `src/lib/push.ts` — VAPID public key + service-worker registration.
- `src/components/PortalBell.tsx` — SSE unread notifications (`GET /api/notifications/unread?scope=portal&
employeeId=`) and push consent; SSE refresh on `notification`, `job-created`, `job-updated`, `workspace-reset`.
- Documents download through the existing server PDF route; no new PDF engine.
- "Reports" is the boss panel's name for the existing Documents & Reports page — no new page.

---

## 7. Phased implementation plan

### Phase 1 — Spec + wire the three live boards (this pass)

1. Rewrite `portal.md` into the spec above (roles/nav/boards/auth/PWA/push/docs) + phased plan.
2. Replace `selectNav`'s toast with live pages for Timesheets, Costs, Documents.
3. Keep `My day` + `My trail` live as today; `Schedule` stays a static preview.
4. Verify: `npm run typecheck` in `gabfix-inhouse-erp/`, `vite build`, `prettier`.

### Phase 2 — Wiring + verification

5. Wire `DocumentsPage` and the role dashboards through the portal nav.
6. Verify the documents page downloads server PDFs; role dashboards render for each `role` in the select.
7. Run the name regression tests (`server/test/jobs-dates.test.ts`, `server/test/crm.test.ts`) plus the
   portal's own unit tests.

### Phase 3 — Polish

8. Confirm SSE refresh, push consent consent flow, and PWA service worker registration end to end.
9. Cleanup: remove any stale `todo` comments left in the handoff state.

---

## 8. Verification checklist

| Check            | Command / method                                                        | Pass criterion                                        |
| ---------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| Server types     | `cd server && npx tsc --noEmit`                                         | clean                                                 |
| Portal types     | `cd gabfix-inhouse-erp && npx tsc --noEmit`                             | clean                                                 |
| Portal build     | `cd gabfix-inhouse-erp && npm run build:dev`                            | succeeds                                              |
| Formatting       | `cd gabfix-inhouse-erp && npm run format`                               | applied                                               |
| Role dashboards  | browser + `role` select                                                 | each role shows its live board                        |
| Documents        | signed-in portal user                                                   | Downloads server PDFs for deliveries/balance/invoices |
| Regression tests | `npx vitest run server/test/jobs-dates.test.ts server/test/crm.test.ts` | 6/6 + 5/5                                             |

---

## 9. Out of scope for this phase

- A server `/schedule` endpoint (Schedule stays static).
- New PDF/report engine (Documents reuses the server route).
- A separate portal auth route (login/me/refresh already exist).

---

## 10. Open items

- None blocking. The portal has no `/portal` or `/employee` route; `/` is the only entry.
