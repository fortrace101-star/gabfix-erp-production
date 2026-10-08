import { useEffect } from "react";

/** Sets the browser tab title (and optional description) for the current page. */
export function useDocumentTitle(title: string, description?: string) {
  useEffect(() => {
    document.title = title;
    if (!description) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [title, description]);
}
