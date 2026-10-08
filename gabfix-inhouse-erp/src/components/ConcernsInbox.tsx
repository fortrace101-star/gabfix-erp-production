import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, MessageSquare } from "lucide-react";
import {
  CONCERN_LABELS,
  raiseConcern,
  resolveConcern,
  useConcerns,
  type JobConcern,
} from "@/lib/concerns";
import { useSession } from "@/lib/session";

/** Compact relative timestamp matching the bell's own helper. */
const age = (iso: string): string => {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/**
 * Manager inbox (plan §2.3 / §12-#2): open concerns raised by field leads.
 *
 * The manager (Supervisor view) sees every `open` concern live, reads the
 * category/body, and resolves it with a note — which the bell reflects as a
 * `concern_raised` row once the staff API is connected (preview persistence is
 * localStorage-backed here per AGENTS.md).
 */
export function ConcernsInbox() {
  const { session } = useSession();
  const { items, reload } = useConcerns();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const resolve = () => {
    const item = resolvingId ? items.find((c) => c.id === resolvingId) : null;
    if (!item || !note.trim()) return;
    try {
      resolveConcern(item.id, note, session?.name ?? "Manager");
      toast.success("Concern resolved", {
        description: `Job ${item.jobNumber} updated — removed from the manager inbox.`,
      });
      setResolvingId(null);
      setNote("");
      reload();
    } catch {
      toast.error("Could not resolve the concern");
    }
  };

  return (
    <section className="surface listing-surface">
      <div className="surface-head">
        <div>
          <p className="eyebrow">MANAGER WORKSPACE</p>
          <h2>Concern requests</h2>
        </div>
        <span className="results-count">{items.length} open</span>
      </div>

      {items.length === 0 && (
        <div className="simple-list">
          <div>
            <span className="list-icon">
              <Check size={18} />
            </span>
            <span>
              <strong>No open concerns</strong>
              <small>Raised concerns land here and push to your bell.</small>
            </span>
          </div>
        </div>
      )}

      {items.map((item: JobConcern) => (
        <div key={item.id} className="concern-row" style={{ alignItems: "flex-start" }}>
          <span className="list-icon">
            <MessageSquare size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>
              {CONCERN_LABELS[item.kind]} — {item.jobNumber} ({item.customer})
            </strong>
            <p style={{ margin: "4px 0 2px" }}>{item.body}</p>
            <small className="muted-note">
              by {item.raisedBy} · {age(item.createdAt)}
            </small>
          </div>
          <span style={{ marginLeft: "auto", whiteSpace: "nowrap", paddingLeft: 12 }}>
            {resolvingId === item.id ? (
              <Button size="sm" onClick={resolve}>
                Confirm
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setResolvingId(item.id);
                  setNote("");
                }}
              >
                Resolve
              </Button>
            )}
          </span>
          {resolvingId === item.id && (
            <div style={{ marginTop: 8, width: "100%" }}>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you do? (required to resolve)"
                rows={2}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
                <Button variant="ghost" size="sm" onClick={() => setResolvingId(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={resolve} disabled={!note.trim()}>
                  Confirm resolve
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
