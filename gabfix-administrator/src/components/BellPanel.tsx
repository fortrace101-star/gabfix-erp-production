import { Button } from "@/components/ui/button";
import { ScopeBell, type BellItem } from "@/components/ScopeBell";

/**
 * Bell panel (plan v5 F1/F2): live unread notifications for the admin scope.
 * Opens from the topbar bell; items are marked read on click; "mark all
 * read" clears the bell. Content refreshes over SSE without polling.
 *
 * `ScopeBell` is the generic per-scope variant — this is the admin-specific
 * thin wrapper that keeps the existing pipe and token key.
 */
export function BellPanel() {
  return (
    <ScopeBell
      scope="admin"
      tokenKey="gabfix-admin:auth-token"
      title="Notifications"
      emptyText="You're all caught up — new events appear here live."
    />
  );
}
