import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  CONCERN_KINDS,
  CONCERN_LABELS,
  raiseConcern,
  type ConcernKind,
  type RaiseConcernInput,
} from "@/lib/concerns";
import { useSession } from "@/lib/session";

/**
 * Field-lead form (plan §2.3 / §12-#2): raise a categorised concern against the
 * current job. Categories mirror the server `job_queries.kind` constraint so a
 * raised concern round-trips to the staff API unchanged once it's connected.
 */
export function ConcernForm({
  jobId,
  jobNumber,
  customer,
  onRaised,
}: {
  jobId: string;
  jobNumber: string;
  customer: string;
  onRaised?: () => void;
}) {
  const { session } = useSession();
  const [kind, setKind] = useState<ConcernKind>(CONCERN_KINDS[0] ?? "other");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const input: Omit<RaiseConcernInput, "raisedBy" | "raisedById"> = {
        jobId,
        jobNumber,
        customer,
        kind,
        body,
      };
      raiseConcern({
        ...input,
        raisedBy: session?.name ?? "Field lead",
        raisedById: session?.id ?? "preview-lead",
      });
      toast.success("Concern raised", {
        description: `Job ${jobNumber} — your manager will review it.`,
      });
      setBody("");
      onRaised?.();
    } catch (err) {
      toast.error("Could not raise the concern", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="concern-form"
      onSubmit={submit}
      aria-label="Raise a concern about this job"
    >
      <div className="concern-form-head" style={{ marginBottom: 8 }}>
        <span className="eyebrow">RAISE A CONCERN</span>
        <small className="muted-note">
          Job {jobNumber} — pick a category; your manager is notified.
        </small>
      </div>
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as ConcernKind)}
        aria-label="Concern category"
        disabled={submitting}
        style={{ width: "100%" }}
      >
        {CONCERN_KINDS.map((k) => (
          <option key={k} value={k}>
            {CONCERN_LABELS[k]}
          </option>
        ))}
      </select>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What's wrong? Crew, kit, schedule, or safety issue on this job…"
        aria-label="Concern details"
        disabled={submitting}
        rows={3}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 8,
        }}
      >
        <Button type="submit" size="sm" disabled={submitting || !body.trim()}>
          Raise concern
        </Button>
      </div>
    </form>
  );
}
