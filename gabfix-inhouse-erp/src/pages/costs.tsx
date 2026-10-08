import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Plus,
  RefreshCw,
  WalletCards,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/Modal";
import { fileCost, useMyFilings, type CostInput, type Filing } from "@/lib/filings";
import { subscribeToJobEvents, useJobOptions } from "@/lib/workspace";
import {
  costAmount,
  costWeekBuckets,
  defaultCostDraft,
  duplicateCostDraft,
  filterCosts,
  previewCostDraft,
  shortMoney,
  sortCosts,
  summarizeCosts,
  type CostDraft,
  type CostSort,
  type CostSortKey,
} from "@/lib/costs";
import {
  addDays,
  dayLongLabel,
  dayMediumLabel,
  jobFilterOptions,
  kampalaDayKey,
  timeLabel,
  weekLabel,
  weekdayName,
} from "@/lib/timesheet";

/**
 * Costs board (plan v5 D3, redesigned) — the Timesheets board's sibling: the
 * same heading / KPI strip / Mon–Sun week strip / toolbar / sortable table
 * shell, pointed at cost lines instead of shifts. Live data is
 * `GET /api/employees/my-filings`; filing goes to `POST /api/costs` through a
 * modal whose preview mirrors the server's pricing rule (an explicit amount
 * wins over quantity × unit cost). Filed lines post to the job's cost straight
 * away — costs need no approval — and SSE (`job-updated`) keeps the board in
 * step with edits made elsewhere in the suite.
 */

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(value);

/** "2 × UGX 12,000" for unit-priced lines, else how the amount was filed. */
function pricingLabel(row: Filing): string {
  const qty = row.qty ?? 0;
  const unit = row.unitCost ?? 0;
  if (qty > 0 && unit > 0) {
    const derived = Math.round(qty * unit);
    return Math.abs(derived - costAmount(row)) < 1
      ? `${qty} × ${money(unit)}`
      : `${qty} × ${money(unit)} · amount override`;
  }
  return "Filed as a fixed amount";
}

export function CostsPage({ employeeId }: { employeeId: string }) {
  const { filings, refresh, loading, error, loaded } = useMyFilings(employeeId || undefined);
  const jobOptions = useJobOptions();
  const [jobId, setJobId] = useState("");
  const [dayKey, setDayKey] = useState("");
  const [query, setQuery] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [sort, setSort] = useState<CostSort>({ key: "createdAt", dir: "desc" });
  const [logOpen, setLogOpen] = useState(false);
  const [draft, setDraft] = useState<CostDraft | null>(null);
  const [detail, setDetail] = useState<Filing | null>(null);

  const today = kampalaDayKey(new Date());
  const anchor = addDays(today, weekOffset * 7);
  // D5: the Costs board is live-only — the backend read has the final word.
  // While the ledger is loading we render the (empty) skeleton; on fetch error
  // we keep the board mounted but empty rather than resurrecting demo rows.
  const rows = loaded ? filings.costs : [];
  if (error) {
    toast.error(error);
  }

  // A cost filed in any app republishes job-updated → refetch here.
  useEffect(() => subscribeToJobEvents(refresh), [refresh]);

  const summary = useMemo(() => summarizeCosts(rows, today), [rows, today]);
  const week = useMemo(() => costWeekBuckets(rows, anchor), [rows, anchor]);
  const peakValue = Math.max(1, ...week.map((bucket) => bucket.value));
  const filtered = useMemo(
    () => sortCosts(filterCosts(rows, { jobId, dayKey, query }), sort),
    [rows, jobId, dayKey, query, sort],
  );
  const filteredValue = filtered.reduce((total, row) => total + costAmount(row), 0);
  const jobs = useMemo(() => jobFilterOptions(rows), [rows]);
  const narrowed = jobId !== "" || dayKey !== "" || query.trim() !== "";
  const freshDraft = useMemo(() => defaultCostDraft(rows), [rows]);

  const clearFilters = () => {
    setJobId("");
    setDayKey("");
    setQuery("");
  };
  const toggleSort = (key: CostSortKey) =>
    setSort((previous) =>
      previous.key === key
        ? { key, dir: previous.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  const sortMark = (key: CostSortKey) =>
    sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
  const ariaSort = (key: CostSortKey) =>
    sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";

  const kpis: Array<{ label: string; value: string; note: string }> = [
    {
      label: "Filed this week",
      value: money(summary.weekValue),
      note: `${summary.weekLines} line${summary.weekLines === 1 ? "" : "s"} · Mon–Sun`,
    },
    {
      label: "Filed today",
      value: money(summary.todayValue),
      note: `${summary.todayLines} line${summary.todayLines === 1 ? "" : "s"} · ${dayMediumLabel(today)}`,
    },
    {
      label: "Lines filed",
      value: String(summary.lines),
      note: `${money(summary.totalValue)} on the ledger`,
    },
    {
      label: "Jobs touched",
      value: String(summary.jobs),
      note: "Each line posts to its job's cost",
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <p>Job costing</p>
          <h1>Costs</h1>
          <span>
            File materials, fuel and subcontract lines against a job. They post to the job's cost
            straight away — no approval step.
          </span>
        </div>
        <div className="heading-actions">
          <Button variant="outline" onClick={() => refresh()} aria-label="Reload my cost lines">
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
            File cost
          </Button>
        </div>
      </div>

      <section className="kpi-strip" aria-label="Cost summary">
        {kpis.map(({ label, value, note }, index) => (
          <article key={label}>
            <div className="kpi-icon">
              {
                [
                  <WalletCards key="week" />,
                  <CalendarDays key="today" />,
                  <ClipboardCheck key="lines" />,
                  <BriefcaseBusiness key="jobs" />,
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
              {money(summary.weekValue)} filed across {summary.weekLines} line
              {summary.weekLines === 1 ? "" : "s"} · tap a day to filter
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
                  bucket.lines
                    ? `${money(bucket.value)} across ${bucket.lines} line${bucket.lines === 1 ? "" : "s"}`
                    : "no lines"
                }`}
                onClick={() => setDayKey(activeDay ? "" : bucket.dayKey)}
              >
                <span>{weekdayName(bucket.dayKey)}</span>
                <span className="week-bar" aria-hidden="true">
                  <i style={{ height: `${Math.round((bucket.value / peakValue) * 100)}%` }} />
                </span>
                <strong>{shortMoney(bucket.value)}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel costs-panel">
        <div className="panel-head">
          <div>
            <h2>Cost lines</h2>
            <p>Newest lines first · tap a row for the full record</p>
          </div>
        </div>

        {error ? <p className="ts-error">{error}</p> : null}

        <div className="ts-toolbar">
          <input
            className="field ts-search"
            type="search"
            value={query}
            placeholder="Search description or job…"
            aria-label="Search cost lines"
            onChange={(event) => setQuery(event.target.value)}
          />

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

        {loading && loaded && rows.length > 0 ? (
          <p className="ts-blank">Refreshing your cost lines…</p>
        ) : null}

        {rows.length === 0 && loading ? (
          <p className="ts-blank">Loading your cost lines…</p>
        ) : rows.length === 0 ? (
          <CostBlank
            title="No cost lines yet"
            body="Capture materials, fuel or subcontract costs against a job. The line posts to the job's cost straight away — no approval step."
            actionLabel="File your first cost"
            onAction={() => {
              setDraft(null);
              setLogOpen(true);
            }}
          />
        ) : filtered.length === 0 ? (
          <CostBlank
            title="No lines match these filters"
            body="Clear the description search, pick another job, or clear the day you tapped on the week strip."
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
                    <th aria-sort={ariaSort("createdAt")}>
                      <button
                        type="button"
                        className="ts-sort"
                        onClick={() => toggleSort("createdAt")}
                      >
                        Date <span>{sortMark("createdAt")}</span>
                      </button>
                    </th>
                    <th aria-sort={ariaSort("job")}>
                      <button type="button" className="ts-sort" onClick={() => toggleSort("job")}>
                        Job <span>{sortMark("job")}</span>
                      </button>
                    </th>
                    <th>Description</th>
                    <th className="num" aria-sort={ariaSort("amount")}>
                      <button
                        type="button"
                        className="ts-sort"
                        onClick={() => toggleSort("amount")}
                      >
                        Amount <span>{sortMark("amount")}</span>
                      </button>
                    </th>
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
                          {dayMediumLabel(kampalaDayKey(row.createdAt)) || "—"}
                        </strong>
                        <span className="ts-meta">{timeLabel(row.createdAt)}</span>
                      </td>
                      <td>
                        <strong className="ts-primary">{row.jobNumber ?? "No job attached"}</strong>
                        <span className="ts-meta">Posted to the job's cost</span>
                      </td>
                      <td>
                        <strong className="ts-primary">{row.description || "Cost line"}</strong>
                        <span className="ts-meta">{pricingLabel(row)}</span>
                      </td>
                      <td className="num">
                        <strong>{money(costAmount(row))}</strong>
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
                    <strong>{dayMediumLabel(kampalaDayKey(row.createdAt)) || "—"}</strong>
                    <strong>{money(costAmount(row))}</strong>
                  </span>
                  <span className="ts-card-job">{row.jobNumber ?? "No job attached"}</span>
                  <span className="ts-meta">{row.description || "Cost line"}</span>
                  <span className="ts-card-foot">
                    <span>
                      <small>Filed</small>
                      <strong>{timeLabel(row.createdAt)}</strong>
                    </span>
                    <span>
                      <small>Quantity</small>
                      <strong>{(row.qty ?? 0) > 0 ? String(row.qty) : "—"}</strong>
                    </span>
                    <span>
                      <small>Unit cost</small>
                      <strong>{(row.unitCost ?? 0) > 0 ? money(row.unitCost ?? 0) : "—"}</strong>
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="ts-foot">
              <span>
                Showing {filtered.length} of {rows.length} cost lines
              </span>
              <span>{money(filteredValue)} filed to jobs</span>
            </div>
          </>
        )}
      </section>

      <LogCostModal
        open={logOpen}
        employeeId={employeeId}
        // Pre-load the board shows demo rows, so offer their jobs (the draft's
        // GF-… default matches); once loaded, prefer the live /data job feed.
        jobs={loaded && jobOptions.length > 0 ? jobOptions : jobs}
        draft={draft}
        fallback={freshDraft}
        onClose={() => setLogOpen(false)}
        onFiled={refresh}
      />

      <CostDetailModal
        row={detail}
        onClose={() => setDetail(null)}
        onDuplicate={(row) => {
          setDetail(null);
          setDraft(duplicateCostDraft(row));
          setLogOpen(true);
        }}
      />
    </>
  );
}

/** Empty and filtered-empty states — both explain the next action. */
function CostBlank({
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
      <WalletCards />
      <strong>{title}</strong>
      <span>{body}</span>
      <Button variant={variant === "outline" ? "outline" : "default"} onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

/**
 * File-cost modal — the only write on this page. The live preview mirrors the
 * server's arithmetic (an explicit amount wins, otherwise quantity × unit cost
 * with quantity defaulting to 1), so what you see is what lands on the job.
 */
function LogCostModal({
  open,
  employeeId,
  jobs,
  draft,
  fallback,
  onClose,
  onFiled,
}: {
  open: boolean;
  employeeId: string;
  jobs: Array<{ id: string; label: string }>;
  draft: CostDraft | null;
  fallback: CostDraft;
  onClose: () => void;
  onFiled: () => void;
}) {
  const [form, setForm] = useState<CostDraft>(draft ?? fallback);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(draft ?? fallback);
    setFailure("");
  }, [open, draft, fallback]);

  const preview = previewCostDraft(form);
  const set = (patch: Partial<CostDraft>) => setForm((previous) => ({ ...previous, ...patch }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.jobId) {
      setFailure("Choose the job this cost belongs to.");
      return;
    }
    if (!form.description.trim()) {
      setFailure("Describe what was bought.");
      return;
    }
    if (!preview) {
      setFailure("Add an amount, or a quantity and unit cost.");
      return;
    }
    setSaving(true);
    setFailure("");
    // Only the fields that priced the line are sent: the server stores qty ×
    // unit when there is no explicit amount, and the explicit amount otherwise.
    const input: CostInput = {
      jobId: form.jobId,
      description: form.description.trim(),
    };
    if (preview.source === "amount") {
      input.amount = preview.amount;
    } else {
      input.qty = preview.qty;
      input.unitCost = preview.unitCost;
    }
    fileCost(input)
      .then(() => {
        toast.success("Cost filed — the job's cost is updated");
        onFiled();
        onClose();
      })
      .catch((cause: unknown) =>
        setFailure(cause instanceof Error ? cause.message : "Could not file the cost"),
      )
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      open={open}
      title="File a cost"
      description="Amount wins over quantity × unit cost — leave the amount empty unless you are overriding the maths."
      onClose={onClose}
    >
      <form className="modal-grid" onSubmit={submit}>
        <Field label="Job">
          <select
            className="field"
            value={form.jobId}
            required
            onChange={(event) => set({ jobId: event.target.value })}
          >
            <option value="">Choose job…</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="What was bought"
          hint="Materials, fuel, subcontract — whatever the line covers."
        >
          <input
            className="field"
            required
            value={form.description}
            placeholder="e.g. PVC fittings + solvent cement"
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>

        <div className="modal-row">
          <Field label="Quantity">
            <input
              type="number"
              min="0"
              step="0.01"
              className="field"
              placeholder="e.g. 2.5"
              value={form.qty}
              onChange={(event) => set({ qty: event.target.value })}
            />
          </Field>
          <Field label="Unit cost (UGX)">
            <input
              type="number"
              min="0"
              step="500"
              className="field"
              placeholder="e.g. 12000"
              value={form.unit}
              onChange={(event) => set({ unit: event.target.value })}
            />
          </Field>
        </div>

        <Field
          label="Amount (UGX)"
          hint="Optional override — a value here wins over quantity × unit cost."
        >
          <input
            type="number"
            min="0"
            step="500"
            className="field"
            placeholder="Leave empty to price qty × unit"
            value={form.amount}
            onChange={(event) => set({ amount: event.target.value })}
          />
        </Field>

        <div className="ts-preview">
          <span>This line</span>
          <strong>{money(preview ? preview.amount : 0)}</strong>
          <small>
            {preview
              ? preview.source === "amount"
                ? "Filed as an explicit amount (overrides qty × unit)"
                : `${preview.qty} × ${money(preview.unitCost)} on the chosen job`
              : "Nothing to price yet — add an amount or a unit cost"}
          </small>
        </div>

        {failure ? <p className="ts-error">{failure}</p> : null}

        <div className="modal-foot">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !employeeId || !preview}>
            {saving ? "Filing…" : "File cost"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Read view for a single filed cost line — the record and quick re-filing. */
function CostDetailModal({
  row,
  onClose,
  onDuplicate,
}: {
  row: Filing | null;
  onClose: () => void;
  onDuplicate: (row: Filing) => void;
}) {
  if (!row) return null;
  const day = kampalaDayKey(row.createdAt);
  const qty = row.qty ?? 0;
  const unit = row.unitCost ?? 0;
  const pricedByUnit =
    qty > 0 && unit > 0 && Math.abs(Math.round(qty * unit) - costAmount(row)) < 1;
  return (
    <Modal
      open
      title={day ? dayLongLabel(day) : "Cost line"}
      description={`${row.jobNumber ?? "No job attached"} · cost line #${row.id}`}
      onClose={onClose}
    >
      <div className="detail-grid ts-detail">
        <div>
          <span>FILED</span>
          <strong>{timeLabel(row.createdAt)}</strong>
        </div>
        <div>
          <span>JOB</span>
          <strong>{row.jobNumber ?? "No job attached"}</strong>
        </div>
        <div>
          <span>QUANTITY</span>
          <strong>{qty > 0 ? String(qty) : "—"}</strong>
        </div>
        <div>
          <span>UNIT COST</span>
          <strong>{unit > 0 ? money(unit) : "—"}</strong>
        </div>
        <div>
          <span>AMOUNT</span>
          <strong>{money(costAmount(row))}</strong>
        </div>
        <div>
          <span>PRICING</span>
          <strong>{pricedByUnit ? "Qty × unit cost" : "Fixed amount"}</strong>
        </div>
      </div>

      <p className="ts-note">
        Filed costs post straight away — this line already sits on the job's cost in the admin
        console. No approval step, unlike timesheets.
      </p>

      <div className="modal-foot">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => onDuplicate(row)}>
          <Plus />
          File another like this
        </Button>
      </div>
    </Modal>
  );
}
