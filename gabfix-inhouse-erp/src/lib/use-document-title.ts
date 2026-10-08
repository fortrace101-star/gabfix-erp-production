import { useEffect } from "react";

/** Sets the browser tab title (and optionally description) on mount. Replaces TanStack's head(). */
export function useDocumentTitle(title: string, description?: string) {
  useEffect(() => {
    document.title = title;
    if (description) {
      const meta = document.querySelector('meta[name="description"]');
      meta?.setAttribute("content", description);
    }
  }, [title, description]);
}
