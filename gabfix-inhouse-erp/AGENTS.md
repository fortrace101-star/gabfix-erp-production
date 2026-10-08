<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting published git history — force pushing, or rebasing/amending/squashing commits that are already pushed — as it rewrites history on Lovable's side and the user will likely lose their project history.
<!-- LOVABLE:END -->

- Keep the portal as a React/TypeScript page under the existing TanStack Start route bootstrap because this workspace cannot replace its framework with a standalone Vite SPA.
- Keep role-specific preview data and interactions in the portal UI until an authenticated staff service is connected, because the uploaded archive's external Express/PostgreSQL API is not available in this workspace.
- Define portal visual roles centrally in `src/styles.css` so all employee views use the same Gabfix palette and status meanings.
