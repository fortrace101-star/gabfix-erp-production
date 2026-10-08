import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/lib/use-document-title";

/**
 * Shared page chrome for the admin console sub-pages — same layout standard as
 * EmployeesPage/SettingsPage: sticky header with back button, centered content
 * column, loading/error states, and modal-based CRUD (no inline forms).
 */
export function AdminPage({
  title,
  subtitle,
  onBack,
  actions,
  error,
  loading,
  children,
}: {
  title: string;
  subtitle: string;
  onBack?: () => void;
  actions?: ReactNode;
  error?: string;
  loading?: boolean;
  children: ReactNode;
}) {
  useDocumentTitle(`${title} — Gabfix Admin Console`, subtitle);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-17 items-center justify-between border-b border-border bg-background/92 px-4 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
              <X />
            </Button>
        )}
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {error && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {error}
          </p>
        )}
        {loading && !error ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

/** Shared modal shell for admin CRUD (matches the store's StoreModal pattern). */
export function AdminModal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button aria-label="Close dialog" className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-card p-6 shadow-2xl sm:rounded-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export const adminFieldLabel =
  "text-sm font-medium text-foreground";
export const adminInputClass =
  "h-10 w-full rounded-md border border-input bg-secondary px-3 text-sm outline-hidden transition focus:border-ring focus:ring-2 focus:ring-ring/20";
