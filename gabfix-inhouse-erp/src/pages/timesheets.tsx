import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Hourglass,
  Plus,
  RefreshCw,
  Timer,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/Modal";
import {
  fileTimesheet,
  minutesBetween,
  useMyFilings,
  type Filing,
  type TimesheetInput,
} from "@/lib/filings";
import { subscribeToJobEvents, useJobOptions } from "@/lib/workspace";
import {
  addDays,
  clashFor,
  dayLongLabel,
  dayMediumLabel,
  defaultShiftDraft,
  duplicateDraft,
  filterShifts,
  hoursLabel,
  isOpenShift,
  jobFilterOptions,
  kampalaDayKey,
  shiftMinutes,
  shiftValue,
  sortShifts,
  summarizeShifts,
  timeLabel,
  weekBuckets,
  weekLabel,
  weekdayName,
  type ShiftDraft,
  type ShiftSort,
  type ShiftSortKey,
  type ShiftStatusFilter,
} from "@/lib/timesheet";

/**
 * Timesheets board (plan v5 D3, redesigned).
 *
 * The page answers the two questions a field hand actually has: "how many hours
 * have I filed this week?" and "has anything been approved yet?". Live data is
 * `GET /api/employees/my-filings`; filing goes to `POST /api/timesheets` through
 * a modal, and admin approvals arrive over SSE (`job-updated`) without a reload.
 */

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(value);

const STATUS_FILTERS: Array<{ id: ShiftStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Awaiting approval" },
  { id: "approved", label: "Approved" },
];

/** `datetime-local` text → ISO instant, or null while the field is empty/invalid. */
function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function TimesheetsPage({ employeeId }: { employeeId: string }) {
  const { filings, refresh, loading, error } = useMyFilings(employeeId || undefined);
  const jobOptions = useJobOptions();
  const [status, setStatus] = useState<ShiftStatusFilter>("all");
  const [jobId, setJobId] = useState("");
  const [dayKey, setDayKey] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [sort, setSort] = useState<ShiftSort>({ key: "startedAt", dir: "desc" });
  const [logOpen, setLogOpen] = useState(false);
  const [draft, setDraft] = useState<ShiftDraft | null>(null);
  const [detail, setDetail] = useState<Filing | null>(null);

  const today = kampalaDayKey(new Date());
  const anchor = addDays(today, weekOffset * 7);
  const rows = filings.timesheets;

  // An approval in the admin console republishes job-updated → refetch here.
  useEffect(() => subscribeToJobEvents(refresh), [refresh]);

  const summary = useMemo(() => summarizeShifts(rows, today), [rows, today]);
  const week = useMemo(() => weekBuckets(rows, anchor), [rows, anchor]);
  const peakMinutes = Math.max(60, ...week.map((bucket) => bucket.minutes));
  const filtered = useMemo(
    () => sortShifts(filterShifts(rows, { status, jobId, dayKey }), sort),
    [rows, status, jobId, dayKey, sort],
  );
  const filteredMinutes = filtered.reduce((total, row) => total + shiftMinutes(row), 0);
  const filteredValue = filtered.reduce((total, row) => total + shiftValue(row), 0);
  const jobs = useMemo(() => jobFilterOptions(rows), [rows]);
  const narrowed = status !== "all" || jobId !== "" || dayKey !== "";
  const freshDraft = useMemo(() => defaultShiftDraft(rows), [rows]);

  const clearFilters = () => {
    setStatus("all");
    setJobId("");
    setDayKey("");
  };
  const toggleSort = (key: ShiftSortKey) =>
    setSort((previous) =>
      previous.key === key
        ? { key, dir: previous.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  const sortMark = (key: ShiftSortKey) =>
    sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
  const ariaSort = (key: ShiftSortKey) =>
    sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";

  const kpis: Array<{ label: string; value: string; note: string }> = [
    {
      label: "Hours this week",
      value: hoursLabel(summary.weekMinutes),
      note: `${summary.weekShifts} shift${summary.weekShifts === 1 ? "" : "s"} · Mon–Sun`,
    },
    {
      label: "Awaiting approval",
      value: String(summary.pending.shifts),
      note: `${money(summary.pending.value)} labour pending`,
    },
    {
      label: "Approved",
      value: String(summary.approved.shifts),
      note: `${hoursLabel(summary.approved.minutes)} costed to jobs`,
    },
    {
      label: "Logged today",
      value: hoursLabel(summary.todayMinutes),
      note: summary.openShifts
        ? `${summary.openShifts} shift still open`
        : summary.missingRate
          ? `${summary.missingRate} shift without a rate`
          : "All shifts closed",
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <p>Field time</p>
          <h1>Timesheets</h1>
          <span>
            Clock every shift against its job. Admin approval turns the hours into a labour cost
            line on that job at the filed rate.
          </span>
        </div>
        <div className="heading-actions">
          <Button variant="outline" onClick={() => refresh()} aria-label="Reload my shifts">
            <RefreshCw />
            Refresh
          </Button>
          <Button
            onClick={() => {
              setDraft(null);
              setLogOpen(true);
            }}
            disabled={!employeeId}
          >
            <Plus />
            Log shift
          </Button>
        </div>
      </div>

      <section className="kpi-strip" aria-label="Timesheet summary">
        {kpis.map(({ label, value, note }, index) => (
          <article key={label}>
            <div className="kpi-icon">
              {
                [
                  <Clock3 key="hours" />,
                  <Hourglass key="pending" />,
                  <ClipboardCheck key="approved" />,
                  <Timer key="today" />,
                ][index]
              }
            </div>
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{note}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="panel week-panel">
        <div className="panel-head">
          <div>
            <h2>Week of {weekLabel(anchor)}</h2>
            <p>
              {hoursLabel(summary.weekMinutes)} filed · {money(summary.weekValue)} at today's rates
              · tap a day to filter
            </p>
          </div>
          <div className="week-nav">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              onClick={() => setWeekOffset((value) => value - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setWeekOffset(0);
                setDayKey("");
              }}
              disabled={weekOffset === 0 && !dayKey}
            >
              This week
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next week"
              onClick={() => setWeekOffset((value) => value + 1)}
              disabled={weekOffset >= 0}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="week-strip">
          {week.map((bucket) => {
            const activeDay = dayKey === bucket.dayKey;
            const isToday = bucket.dayKey === today;
            return (
              <button
                type="button"
                key={bucket.dayKey}
                className={`week-day${activeDay ? " week-day-active" : ""}${
                  isToday ? " week-day-today" : ""
                }`}
                aria-pressed={activeDay}
                title={`${dayMediumLabel(bucket.dayKey)} — ${
                  bucket.shifts
                    ? `${hoursLabel(bucket.minutes)} across ${bucket.shifts} shift(s)`
                    : "no shifts"
                }`}
                onClick={() => setDayKey(activeDay ? "" : bucket.dayKey)}
              >
                <span>{weekdayName(bucket.dayKey)}</span>
                <span className="week-bar" aria-hidden="true">
                  <i style={{ height: `${Math.round((bucket.minutes / peakMinutes) * 100)}%` }} />
                </span>
                <strong>{bucket.minutes ? hoursLabel(bucket.minutes) : "—"}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel shifts-panel">
        <div className="panel-head">
          <div>
            <h2>Filed shifts</h2>
            <p>Newest 20 shifts the server keeps for you · tap a row for the full record</p>
          </div>
        </div>

        {error ? <p className="ts-error">{error}</p> : null}

        <div className="ts-toolbar">
          <div className="segmented" role="tablist" aria-label="Filter by approval">
            {STATUS_FILTERS.map((option) => {
              const count =
                option.id === "all"
                  ? rows.length
                  : option.id === "pending"
                    ? summary.pending.shifts
                    : summary.approved.shifts;
              const activeFilter = status === option.id;
              return (
                <button
                  type="button"
                  key={option.id}
                  role="tab"
                  aria-selected={activeFilter}
                  className={`seg${activeFilter ? " seg-active" : ""}`}
                  onClick={() => setStatus(option.id)}
                >
                  {option.label}
                  <b>{count}</b>
                </button>
              );
            })}
          </div>

          <select
            className="field ts-job-filter"
            value={jobId}
            aria-label="Filter by job"
            onChange={(event) => setJobId(event.target.value)}
          >
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.label}
              </option>
            ))}
          </select>

          {dayKey ? (
            <Button variant="outline" size="sm" onClick={() => setDayKey("")}>
              <X />
              {dayMediumLabel(dayKey)}
            </Button>
          ) : null}

          {narrowed ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>

        {loading && rows.length > 0 ? <p className="ts-blank">Refreshing your shifts…</p> : null}

        {rows.length === 0 && loading ? (
          <p className="ts-blank">Loading your shifts…</p>
        ) : rows.length === 0 ? (
          <ShiftBlank
            title="No shifts filed yet"
            body="Clock your first shift against a job. It lands here straight away, and approval in the Admin Console turns the hours into a labour cost line on that job."
            actionLabel="Log your first shift"
            onAction={() => {
              setDraft(null);
              setLogOpen(true);
            }}
          />
        ) : filtered.length === 0 ? (
          <ShiftBlank
            title="No shifts match these filters"
            body="Widen the approval filter, pick another job, or clear the day you tapped on the week strip."
            actionLabel="Clear filters"
            onAction={clearFilters}
            variant="outline"
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="ts-table">
                <thead>
                  <tr>
                    <th aria-sort={ariaSort("startedAt")}>
                      <button
                        type="button"
                        className="ts-sort"
                        onClick={() => toggleSort("startedAt")}
                      >
                        Date <span>{sortMark("startedAt")}</span>
                      </button>
                    </th>
                    <th>Job</th>
                    <th className="num" aria-sort={ariaSort("hours")}>
                      <button type="button" className="ts-sort" onClick={() => toggleSort("hours")}>
                        Hours <span>{sortMark("hours")}</span>
                      </button>
                    </th>
                    <th className="num">Rate</th>
                    <th className="num" aria-sort={ariaSort("value")}>
                      <button type="button" className="ts-sort" onClick={() => toggleSort("value")}>
                        Value <span>{sortMark("value")}</span>
                      </button>
                    </th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      onClick={() => setDetail(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setDetail(row);
                      }}
                    >
                      <td>
                        <strong className="ts-primary">
                          {dayMediumLabel(kampalaDayKey(row.startedAt)) || "—"}
                        </strong>
                        <span className="ts-meta">
                          {timeLabel(row.startedAt)} →{" "}
                          {row.endedAt ? timeLabel(row.endedAt) : "open"}
                        </span>
                      </td>
                      <td>
                        <strong className="ts-primary">{row.jobNumber ?? "No specific job"}</strong>
                        <span className="ts-meta">
                          {row.jobNumber
                            ? "Costed to the job on approval"
                            : "Overhead time — no job attached"}
                        </span>
                      </td>
                      <td className="num">
                        <strong>{hoursLabel(shiftMinutes(row))}</strong>
                        {isOpenShift(row) ? <span className="ts-meta">still open</span> : null}
                      </td>
                      <td className="num">{row.rate ? `${money(row.rate)}/h` : "—"}</td>
                      <td className="num">
                        <strong>{money(shiftValue(row))}</strong>
                      </td>
                      <td>
                        <ShiftStatus approved={Boolean(row.approved)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ts-cards">
              {filtered.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className="ts-card"
                  onClick={() => setDetail(row)}
                >
                  <span className="ts-card-top">
                    <strong>{dayMediumLabel(kampalaDayKey(row.startedAt)) || "—"}</strong>
                    <ShiftStatus approved={Boolean(row.approved)} />
                  </span>
                  <span className="ts-card-job">{row.jobNumber ?? "No specific job"}</span>
                  <span className="ts-meta">
                    {timeLabel(row.startedAt)} → {row.endedAt ? timeLabel(row.endedAt) : "open"}
                  </span>
                  <span className="ts-card-foot">
                    <span>
                      <small>Hours</small>
                      <strong>{hoursLabel(shiftMinutes(row))}</strong>
                    </span>
                    <span>
                      <small>Rate</small>
                      <strong>{row.rate ? `${money(row.rate)}/h` : "—"}</strong>
                    </span>
                    <span>
                      <small>Value</small>
                      <strong>{money(shiftValue(row))}</strong>
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="ts-foot">
              <span>
                Showing {filtered.length} of {rows.length} filed shifts
              </span>
              <span>
                {hoursLabel(filteredMinutes)} · {money(filteredValue)} at filed rates
              </span>
            </div>
          </>
        )}
      </section>

      <LogShiftModal
        open={logOpen}
        employeeId={employeeId}
        jobs={jobOptions}
        shifts={rows}
        draft={draft}
        fallback={freshDraft}
        onClose={() => setLogOpen(false)}
        onFiled={refresh}
      />

      <ShiftDetailModal
        row={detail}
        onClose={() => setDetail(null)}
        onDuplicate={(row) => {
          setDetail(null);
          setDraft(duplicateDraft(row));
          setLogOpen(true);
        }}
      />
    </>
  );
}

/** Approval chip shared by the table and the phone cards. */
function ShiftStatus({ approved }: { approved: boolean }) {
  return (
    <span className={`status ${approved ? "status-completed" : "status-scheduled"}`}>
      <span />
      {approved ? "Approved" : "Awaiting approval"}
    </span>
  );
}

/** Empty and filtered-empty states — both explain the next action. */
function ShiftBlank({
  title,
  body,
  actionLabel,
  onAction,
  variant = "default",
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  variant?: "default" | "outline";
}) {
  return (
    <div className="ts-blank-state">
      <Clock3 />
      <strong>{title}</strong>
      <span>{body}</span>
      <Button variant={variant === "outline" ? "outline" : "default"} onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

/**
 * Log-shift modal — the only write on this page. The live preview mirrors the
 * server's arithmetic (minutes from the range, value = minutes ÷ 60 × rate), and
 * an overlapping filed shift is flagged without blocking the filing.
 */
function LogShiftModal({
  open,
  employeeId,
  jobs,
  shifts,
  draft,
  fallback,
  onClose,
  onFiled,
}: {
  open: boolean;
  employeeId: string;
  jobs: Array<{ id: string; label: string }>;
  shifts: Filing[];
  draft: ShiftDraft | null;
  fallback: ShiftDraft;
  onClose: () => void;
  onFiled: () => void;
}) {
  const [form, setForm] = useState<ShiftDraft>(draft ?? fallback);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(draft ?? fallback);
    setFailure("");
  }, [open, draft, fallback]);

  const startIso = toIso(form.startedAt);
  const endIso = toIso(form.endedAt);
  const minutes = startIso && endIso ? Math.max(0, minutesBetween(startIso, endIso)) : 0;
  const rate = Number(form.rate) || 0;
  const endBeforeStart = Boolean(startIso && endIso) && minutes <= 0;
  const clash = startIso ? clashFor(shifts, startIso, endIso) : null;
  const preview = minutes > 0 ? Math.round((minutes / 60) * rate) : 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!startIso) {
      setFailure("Add the date and time the shift started.");
      return;
    }
    if (endIso && minutes <= 0) {
      setFailure("The end time has to come after the start time.");
      return;
    }
    setSaving(true);
    setFailure("");
    const filing: TimesheetInput = { employeeId, startedAt: startIso };
    if (form.jobId) filing.jobId = form.jobId;
    if (endIso) {
      filing.endedAt = endIso;
      if (minutes > 0) filing.minutes = minutes;
    }
    if (rate > 0) filing.rate = rate;
    fileTimesheet(filing)
      .then(() => {
        toast.success("Shift filed — awaiting approval");
        onFiled();
        onClose();
      })
      .catch((cause: unknown) =>
        setFailure(cause instanceof Error ? cause.message : "Could not file the shift"),
      )
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      open={open}
      title="Log a shift"
      description="Minutes come from the start and end times — leave the end empty while you are still on shift."
      onClose={onClose}
    >
      <form className="modal-grid" onSubmit={submit}>
        <Field label="Job">
          <select
            className="field"
            value={form.jobId}
            onChange={(event) => setForm({ ...form, jobId: event.target.value })}
          >
            <option value="">No specific job (overhead time)</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="modal-row">
          <Field label="Started">
            <input
              type="datetime-local"
              className="field"
              required
              value={form.startedAt}
              onChange={(event) => setForm({ ...form, startedAt: event.target.value })}
            />
          </Field>
          <Field label="Ended">
            <input
              type="datetime-local"
              className="field"
              value={form.endedAt}
              onChange={(event) => setForm({ ...form, endedAt: event.target.value })}
            />
          </Field>
        </div>

        <Field
          label="Hourly rate (UGX)"
          hint="Filed on the shift — approval costs the job at this rate."
        >
          <input
            type="number"
            min="0"
            step="500"
            className="field"
            placeholder="e.g. 7500"
            value={form.rate}
            onChange={(event) => setForm({ ...form, rate: event.target.value })}
          />
        </Field>

        <div className="ts-preview">
          <span>This shift</span>
          <strong>{minutes > 0 ? hoursLabel(minutes) : "open"}</strong>
          <small>
            {preview > 0
              ? `${money(preview)} of labour at ${money(rate)}/h`
              : "Add an hourly rate so approval can cost the job"}
          </small>
        </div>

        {endBeforeStart ? (
          <p className="ts-error">The end time is before the start time — fix it before filing.</p>
        ) : null}
        {clash ? (
          <p className="ts-alert">
            Overlaps {clash.jobNumber ?? "another shift"} ({timeLabel(clash.startedAt)} →{" "}
            {clash.endedAt ? timeLabel(clash.endedAt) : "open"}). File it only if that
            double-booking is intentional.
          </p>
        ) : null}
        {failure ? <p className="ts-error">{failure}</p> : null}

        <div className="modal-foot">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !employeeId || endBeforeStart}>
            {saving ? "Filing…" : "File shift"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
/** Read view for a single filed shift — the record, approval state and re-filing. */
function ShiftDetailModal({
  row,
  onClose,
  onDuplicate,
}: {
  row: Filing | null;
  onClose: () => void;
  onDuplicate: (row: Filing) => void;
}) {
  if (!row) return null;
  const day = kampalaDayKey(row.startedAt);
  return (
    <Modal
      open
      title={day ? dayLongLabel(day) : "Filed shift"}
      description={`${row.jobNumber ?? "No specific job"} · shift #${row.id}`}
      onClose={onClose}
    >
      <div className="detail-grid ts-detail">
        <div>
          <span>STARTED</span>
          <strong>{timeLabel(row.startedAt)}</strong>
        </div>
        <div>
          <span>ENDED</span>
          <strong>{row.endedAt ? timeLabel(row.endedAt) : "still open"}</strong>
        </div>
        <div>
          <span>HOURS</span>
          <strong>{hoursLabel(shiftMinutes(row))}</strong>
        </div>
        <div>
          <span>RATE</span>
          <strong>{row.rate ? `${money(row.rate)}/h` : "not filed"}</strong>
        </div>
        <div>
          <span>LABOUR VALUE</span>
          <strong>{money(shiftValue(row))}</strong>
        </div>
        <div>
          <span>STATUS</span>
          <strong>{row.approved ? "Approved" : "Awaiting approval"}</strong>
        </div>
      </div>

      <p className="ts-note">
        {row.approved
          ? "Approved — these hours already sit on the job's cost as a labour line."
          : "Awaiting approval — approval in the Admin Console posts the labour cost line for this job at the rate above."}
      </p>

      <div className="modal-foot">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => onDuplicate(row)}>
          <Plus />
          Log a similar shift
        </Button>
      </div>
    </Modal>
  );
}
