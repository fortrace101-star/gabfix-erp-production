# React + Vite Conversion — gabfix-administrator

This document records the changes made to convert the gabfix-administrator console
from **TanStack Start** (SSR, nitro, bun, Lovable) into a basic **React + Vite + TypeScript**
project with `App.tsx` as the entry point. No TanStack Query or TanStack Router remain
in this project.

## Summary of Changes

| # | Type       | File / Scope                          | Description                                                        |
|---|------------|----------------------------------------|--------------------------------------------------------------------|
| 1 | **Created** | `index.html`                           | Standard Vite HTML entry with `<div id="root">` and `/src/main.tsx` script tag. |
| 2 | **Created** | `src/App.tsx`                          | Root application component with TypeScript generics (`useState<"dashboard" | "logs">`). |
| 3 | **Created** | `src/main.tsx`                         | React DOM entry point using `ReactDOM.createRoot` with `StrictMode` and `!` non-null assertion. |
| 4 | **Deleted** | `src/start.ts`                         | TanStack Start server entry point removed.                         |
| 5 | **Deleted** | `src/server.ts`                        | TanStack Start server configuration removed.                        |
| 6 | **Deleted** | `src/router.tsx`                       | TanStack Router configuration removed.                              |
| 7 | **Deleted** | `src/routeTree.gen.ts`                 | Auto-generated TanStack route tree removed.                        |
| 8 | **Deleted** | `src/routes/` (directory)              | All TanStack route files removed.                                   |
| 9 | **Deleted** | `src/lib/lovable-error-reporting.ts`   | Lovable error reporting wrapper removed.                           |
| 10| **Deleted** | `src/lib/error-capture.ts`             | Lovable error capture utility removed.                             |
| 11| **Deleted** | `src/lib/error-page.ts`                | TanStack error page component removed.                             |
| 12| **Deleted** | `bunfig.toml`                          | Bun configuration file removed.                                    |
| 13| **Deleted** | `bun.lock`                             | Bun lockfile removed.                                              |
| 14| **Deleted** | `.lovable/` (directory)                | Lovable directory removed.                                         |
| 15| **Modified**| `package.json`                         | Scripts rewritten (`dev`, `build`, `preview`, `lint`, `format`). Removed `@tanstack/*` deps (start, router, react-query, router-plugin). Removed `vite-tsconfig-paths` dev dep. Fixed `@radix-ui/react-menubar` version `^1.2.16` → `^1.1.16`. Stripped UTF-8 BOM. |
| 16| **Modified**| `vite.config.ts`                       | Rewritten for standard Vite + React + Tailwind v4. Removed `vite-tsconfig-paths` import; uses Vite 8 native `resolve.tsconfigPaths: true`. Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`. |
| 17| **Modified**| `eslint.config.js`                     | Removed TanStack `no-restricted-imports` rule. Added `jsx` to file glob pattern (`**/*.{ts,tsx,jsx,js}`). |
| 18| **Modified**| `.prettierignore`                      | Added `dist`, `.output`, `package-lock.json`.                       |
| 19| **Modified**| `README.md`                            | Updated to document React + Vite + TypeScript stack and setup instructions. |
| 20| **Fixed**   | `package.json` (BOM)                   | `npm uninstall` re-added UTF-8 BOM when writing `package.json`. Vite's PostCSS config loader reads `package.json` and fails on BOM with `SyntaxError: Unexpected token 'ï»¿'`. Fixed by stripping BOM with `[System.IO.File]::WriteAllBytes`. |

## Unchanged

The following files were **not modified** — they work directly with Vite and the
`@tailwindcss/vite` plugin:

- `src/styles.css` — Uses Tailwind v4 `@import` syntax, works natively.
- `src/components/ui/*` — All 46 shadcn/ui components (no TanStack imports).
- `src/components/admin-dashboard.tsx` — Main dashboard component.
- `src/lib/utils.ts` — Utility functions.
- `src/hooks/use-mobile.tsx` — Mobile breakpoint hook.
- `~$public/gabfix-logo.png`~ → **`public/gabfix-logo.png`** (created) — Real logo binary (24,509 bytes) copied from the master logo file, replacing the Lovable `src/assets/gabfix-logo.png.asset.json` indirection. JSX now references `/gabfix-logo.png` directly. |
- `components.json` — shadcn/ui configuration.
- `.prettierrc` — Prettier configuration.
- `tsconfig.json` — TypeScript with `@/*` → `./src/*` path alias.
- `.gitignore`

## Verification

| Check                          | Result |
|--------------------------------|--------|
| `npx tsc --noEmit`             | ✅ Passes (exit code 0) |
| `npx vite build`               | ✅ Succeeds (2367 modules, `dist/` output) |
| `npm run dev` (port 5173)      | ✅ HTTP 200, AdminDashboard renders |
| No `@tanstack` imports         | ✅ Zero references in admin project |
| No BOM in any project file     | ✅ All files clean |
| `vite-tsconfig-paths` removed  | ✅ Not in `package.json` or `node_modules` |
| No temp files left             | ✅ All cleaned up |

## Root Cause of Build Error

The initial Vite production build failed with:

```
[plugin vite:css] Failed to load PostCSS config:
SyntaxError: Unexpected token 'ï»¿', "ï»¿{\r\n  \"name\"..."
```

**Root cause**: PowerShell's `Set-Content -Encoding UTF8` and `npm uninstall`
both write files with a UTF-8 BOM (`0xEF 0xBB 0xBF`). Vite's PostCSS config
loader reads `package.json` as JSON via `JSON.parse()`, which fails on BOM.

**Fix**: Strip the BOM using raw byte manipulation:

```powershell
$bytes = [System.IO.File]::ReadAllBytes($path)
if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $clean = $bytes[3..($bytes.Length-1)]
    [System.IO.File]::WriteAllBytes($path, $clean)
}
```

After stripping the BOM from `package.json` (and verifying no BOMs in
`tsconfig.json` or any other project file), the build succeeds cleanly.
