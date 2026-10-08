import { apiClient } from "@/lib/api";

/**
 * Server-rendered PDF download (Phase 2 document service, 11 doc types).
 * Fetches with auth headers and hands the bytes to the browser as a file —
 * the server sets Content-Disposition with the numbered filename
 * (e.g. INV-00098.pdf) which we reuse client-side.
 */

export type DocumentType =
  | "invoice"
  | "receipt"
  | "laundry"
  | "job-card"
  | "statement"
  | "delivery-note"
  | "manifest"
  | "aging"
  | "assets"
  | "pl"
  | "balance-sheet";

async function download(path: string, fallbackName: string) {
  const response = await fetch(`${apiClient.baseUrl}${path}`, {
    headers: {
      "X-App-Id": import.meta.env.VITE_APP_ID ?? "admin",
      Authorization: `Bearer ${localStorage.getItem("gabfix-admin:auth-token") ?? ""}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`PDF download failed (${response.status}): ${body}`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = match?.[1] ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Entity document: GET /api/documents/:type/:id.pdf */
export function downloadEntityPdf(type: DocumentType, id: string, fallbackName?: string) {
  return download(
    `/documents/${type}/${encodeURIComponent(id)}.pdf`,
    fallbackName ?? `${type}-${id}.pdf`,
  );
}

/** Register/range document: GET /api/documents/:type.pdf (?from=&to= for pl) */
export function downloadRegisterPdf(type: DocumentType, range?: { from: string; to: string }) {
  const qs = range ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : "";
  return download(`/documents/${type}.pdf${qs}`, `${type}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
