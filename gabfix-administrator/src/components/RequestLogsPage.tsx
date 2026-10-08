/**
 * Request logs page — tabs between live SSE feed and historical query view.
 */

import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { LogFeed } from "@/components/LogFeed";
import { LogHistory } from "@/components/LogHistory";

const tabs = [
  { id: "live", label: "Live Feed" },
  { id: "history", label: "History" },
] as const;
type TabId = (typeof tabs)[number]["id"];

export function RequestLogsPage({ onBack }: { onBack?: () => void }) {
  const [tab, setTab] = useState<TabId>("live");

  return (
    <div className="p-6">
      {/* Top bar with back button */}
      <div className="mb-4 flex items-center gap-4">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to dashboard
          </button>
        )}
        <h1 className="text-xl font-semibold">Request Logs</h1>
      </div>

      {/* Tab header */}
      <div className="mb-4 flex items-center gap-1 rounded-md border bg-card p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "live" && <LogFeed />}
      {tab === "history" && <LogHistory />}
    </div>
  );
}
