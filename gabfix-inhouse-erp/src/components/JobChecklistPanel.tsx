import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { portalApi } from "@/lib/api";

/**
 * Per-stage job checklist + activity log (migration 025).
 *
 * A job carries a checklist for every stage it passes through, starting with
 * "Inspection". The server seeds each stage's template when the job enters it
 * and never overwrites a stage that already has items, so everything here stays
 * editable: crew tick work off, add what the template missed, remove what does
 * not apply — and write into the activity log to capture anything that happened
 * but never got recorded at the time.
 */

export type ChecklistItem = {
  id: string;
  stage: string;
  label: string;
  position: number;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
};

export type JobActivity = {
  id: string;
  stage: string;
  body: string;
  employeeId: string | null;
  employeeName: string | null;
  createdAt: string;
};

const STAGE_ORDER = [
  "Inspection",
  "Quoted",
  "Scheduled",
  "In Progress",
  "Completed",
  "Invoiced",
  "Paid",
] as const;

const stageRank = (stage: string): number => {
  const index = (STAGE_ORDER as readonly string[]).indexOf(stage);
  return index === -1 ? STAGE_ORDER.length : index;
};

const stamp = (iso: string): string => iso.slice(0, 16).replace("T", " ");

export function JobChecklistPanel({
  jobId,
  currentStage,
  onChecklistReady,
}: {
  jobId: string;
  currentStage: string;
  /** Fires with (done, total) whenever the checklist loads or changes. */
  onChecklistReady?: (done: number, total: number) => void;
}) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [activities, setActivities] = useState<JobActivity[]>([]);
  const [newItem, setNewItem] = useState("");
  const [newItemStage, setNewItemStage] = useState(currentStage);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [checklist, log] = await Promise.all([
        portalApi.get<{ items: ChecklistItem[] }>(`/jobs/${jobId}/checklist`),
        portalApi.get<JobActivity[]>(`/jobs/${jobId}/activities`),
      ]);
      setItems(checklist.items);
      setActivities(log);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the job record");
    }
  }, [jobId]);

  useEffect(() => {
    setNewItemStage(currentStage);
    void load();
  }, [load, currentStage]);

  useEffect(() => {
    onChecklistReady?.(items.filter((item) => item.done).length, items.length);
  }, [items, onChecklistReady]);

  const grouped = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of items) {
      const rows = map.get(item.stage) ?? [];
      rows.push(item);
      map.set(item.stage, rows);
    }
    return [...map.entries()].sort(([a], [b]) => stageRank(a) - stageRank(b));
  }, [items]);

  const stageOptions = useMemo(() => {
    const present = new Set(items.map((item) => item.stage));
    present.add(currentStage);
    return [...present].sort((a, b) => stageRank(a) - stageRank(b));
  }, [items, currentStage]);

  const doneCount = items.filter((item) => item.done).length;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the job record");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (item: ChecklistItem) =>
    void run(async () => {
      await portalApi.request(`/jobs/${jobId}/checklist/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !item.done }),
      });
    });

  const remove = (item: ChecklistItem) =>
    void run(async () => {
      await portalApi.request(`/jobs/${jobId}/checklist/${item.id}`, { method: "DELETE" });
    });

  const addItem = (event: FormEvent) => {
    event.preventDefault();
    const label = newItem.trim();
    if (!label) return;
    void run(async () => {
      await portalApi.request(`/jobs/${jobId}/checklist`, {
        method: "POST",
        body: JSON.stringify({ stage: newItemStage, label }),
      });
      setNewItem("");
    });
  };

  const addNote = (event: FormEvent) => {
    event.preventDefault();
    const body = note.trim();
    if (!body) return;
    void run(async () => {
      await portalApi.request(`/jobs/${jobId}/activities`, {
        method: "POST",
        body: JSON.stringify({ stage: newItemStage, body }),
      });
      setNote("");
    });
  };
  return (
    <>
      <div className="drawer-divider" />
      <div className="drawer-section-head">
        <h3>Checklist</h3>
        <span>
          {doneCount}/{items.length} done
        </span>
      </div>
      {grouped.map(([stage, rows]) => (
        <section className="checklist-stage" key={stage}>
          <div className="stage-tag">
            <strong>{stage}</strong>
            <span>
              {rows.filter((row) => row.done).length}/{rows.length}
            </span>
          </div>
          <div className="checklist">
            {rows.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={busy}
                  onChange={() => toggle(item)}
                />
                <span className={item.done ? "done" : ""}>{item.label}</span>
                <button
                  type="button"
                  className="item-remove"
                  aria-label={`Remove ${item.label}`}
                  title="Remove this item"
                  disabled={busy}
                  onClick={() => remove(item)}
                >
                  <Trash2 size={13} />
                </button>
              </label>
            ))}
          </div>
        </section>
      ))}
      <form className="add-item-row" onSubmit={addItem}>
        <select
          aria-label="Stage for the new item"
          value={newItemStage}
          onChange={(e) => setNewItemStage(e.target.value)}
        >
          {stageOptions.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Add a checklist item…"
          aria-label="New checklist item"
        />
        <Button type="submit" variant="outline" size="sm" disabled={busy || !newItem.trim()}>
          <Plus size={15} />
        </Button>
      </form>
      <div className="drawer-divider" />
      <div className="drawer-section-head">
        <h3>Activity log</h3>
        <span>
          {activities.length} {activities.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      <form className="drawer-label" onSubmit={addNote}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened on this job? Add anything that wasn't captured at the time — it can be written later."
          aria-label="New activity entry"
        />
        <Button type="submit" size="sm" disabled={busy || !note.trim()}>
          Log activity
        </Button>
      </form>
      <div className="activity-log">
        {activities.map((entry) => (
          <div key={entry.id}>
            <strong>{entry.body}</strong>
            <small>
              {entry.employeeName ?? "System"} · {entry.stage} · {stamp(entry.createdAt)}
            </small>
          </div>
        ))}
        {activities.length === 0 && (
          <p className="muted-note">
            Nothing logged yet — record what was done, including anything missed at the time.
          </p>
        )}
      </div>
      {error && <p className="drawer-error">{error}</p>}
    </>
  );
}
