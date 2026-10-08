import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/Modal";
import {
  scheduleFollowUp,
  logInteraction,
  type FollowUpInput,
  type InteractionInput,
} from "@/lib/crm";
import { toLocalInput } from "@/lib/timesheet";
import { stampFrom } from "./shared";

/** Default reminder: tomorrow at 09:00 (device local). */
export function tomorrowAt(time = "09:00"): { date: string; time: string } {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { date: toLocalInput(tomorrow).slice(0, 10), time };
}

type ScheduleDefaults = {
  type?: FollowUpInput["type"] | undefined;
  customerId?: string | undefined;
  leadId?: string | undefined;
  jobId?: string | undefined;
  subject?: string | undefined;
};

/**
 * "Schedule follow-up" modal — the reminder that returns to the dashboard at
 * the chosen date + time (decision B3: a real timestamp, not a day count).
 */
export function ScheduleFollowUpModal({
  open,
  defaults,
  onClose,
  onSaved,
}: {
  open: boolean;
  defaults: ScheduleDefaults;
  onClose: () => void;
  onSaved: () => void;
}) {
  const seed = tomorrowAt();
  const [date, setDate] = useState(seed.date);
  const [time, setTime] = useState(seed.time);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const dueAt = stampFrom(date, time);
    if (!dueAt) {
      setFailure("Pick a date and a time for the reminder.");
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      await scheduleFollowUp({
        type: defaults.type ?? "client_follow_up",
        customerId: defaults.customerId,
        leadId: defaults.leadId,
        jobId: defaults.jobId,
        dueAt,
        notes: notes.trim(),
      });
      toast.success("Follow-up scheduled — it will appear here when due");
      setNotes("");
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not schedule the follow-up");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      open
      title="Schedule a follow-up"
      description={
        defaults.subject ? `For ${defaults.subject}` : "Set the day and time you'll be reminded"
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="modal-form">
        <div className="field-row">
          <Field label="Date">
            <input
              type="date"
              className="field"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              className="field"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes" hint="Optional — what should this touch cover?">
          <input
            className="field"
            placeholder="Confirm site access, discuss the quote…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {failure ? <p className="ts-error">{failure}</p> : null}
        <div className="modal-foot">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Scheduling…" : "Schedule follow-up"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Log an interaction" modal — the sales/CSR contact record + next touch. */
export function InteractionModal({
  open,
  defaults,
  onClose,
  onSaved,
}: {
  open: boolean;
  defaults: {
    customerId?: string | undefined;
    leadId?: string | undefined;
    jobId?: string | undefined;
    subject?: string | undefined;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const seed = tomorrowAt();
  const [channel, setChannel] = useState<InteractionInput["channel"]>("call");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [chain, setChain] = useState(false);
  const [nextDate, setNextDate] = useState(seed.date);
  const [nextTime, setNextTime] = useState(seed.time);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!notes.trim()) {
      setFailure("Add a short note about the contact.");
      return;
    }
    const nextFollowUpAt = chain ? stampFrom(nextDate, nextTime) : null;
    if (chain && !nextFollowUpAt) {
      setFailure("Pick the date and time for the next touch.");
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      await logInteraction({
        customerId: defaults.customerId,
        leadId: defaults.leadId,
        jobId: defaults.jobId,
        channel,
        notes: notes.trim(),
        outcome: outcome.trim(),
        nextFollowUpAt: nextFollowUpAt ?? undefined,
      });
      toast.success("Interaction logged");
      setNotes("");
      setOutcome("");
      setChain(false);
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not log the interaction");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      open
      title="Log an interaction"
      description={defaults.subject ? `With ${defaults.subject}` : "Record a client contact"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="modal-form">
        <Field label="Channel">
          <select
            className="field"
            value={channel}
            onChange={(event) => setChannel(event.target.value as InteractionInput["channel"])}
          >
            <option value="call">Phone call</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="site">On site</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="What was discussed" hint="Required — this lands in the interaction log.">
          <textarea
            className="field"
            rows={3}
            required
            placeholder="Confirmed the install date; asked about access…"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <Field label="Outcome" hint="Optional — where things stand now.">
          <input
            className="field"
            placeholder="Happy to proceed · awaiting quote approval…"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={chain}
            onChange={(event) => setChain(event.target.checked)}
          />
          Schedule the next touch from this contact
        </label>
        {chain ? (
          <div className="field-row">
            <Field label="Next date">
              <input
                type="date"
                className="field"
                required
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
              />
            </Field>
            <Field label="Next time">
              <input
                type="time"
                className="field"
                required
                value={nextTime}
                onChange={(e) => setNextTime(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
        {failure ? <p className="ts-error">{failure}</p> : null}
        <div className="modal-foot">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Log interaction"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
