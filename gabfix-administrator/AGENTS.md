# Gabfix Admin Console

Plain Vite + React + TypeScript SPA — the control plane of the Gabfix ERP.

- **One server, no BaaS.** All backend access goes through the Express API behind `src/lib/api.ts` (`apiClient` with `X-App-Id: admin` from `VITE_APP_ID`, bearer auth, 401→refresh→retry). Copy `.env.example` to `.env` (`VITE_API_BASE_URL`, `VITE_APP_ID=admin`). No third-party BaaS, no direct DB access from the browser.
- **Access-control apex (Phase B):** the Admin Console is where staff accounts are created and employees' `app_scope` (admin/laundry/portal/store) is granted/revoked. The server enforces scopes on every mount; `AUTH_ENFORCE=true` is the go-live switch.
- **Canonical auth contract:** `POST /api/auth/login|refresh`, `GET /api/auth/me`, `/logout` returning `{accessToken, refreshToken, user: {id, name, role, app_scope}}`. No self sign-up anywhere in the suite (D3).
- **Single source of truth:** apps render from `GET /api/data` (whole-workspace read, incl. store collections); cross-app updates arrive via SSE at `/api/events`; every request is logged server-side with the app tag — `[admin] GET /api/data 200 12ms` — and visible in the in-app request-log viewer (`GET /api/logs`, admin-only).
- **PWAs across the suite:** manifest + service worker (vite-plugin-pwa), vendored UI kit (shadcn-style, 46 components), Inter typography, 8px grid, green accent tokens via CSS variables (no hex literals in views).
- `react.md` is a historical migration record — kept as-is, not part of the active architecture.
