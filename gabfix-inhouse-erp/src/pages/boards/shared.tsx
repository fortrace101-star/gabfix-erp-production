import {
  BriefcaseBusiness,
  CalendarCheck,
  CircleDollarSign,
  Clock3,
  ClipboardCheck,
  Star,
  Target,
  Users,
} from "lucide-react";

/**
 * Shared building blocks for the role dashboards: the KPI strip (same markup
 * the My-day shell already styles) plus formatting helpers. The entry modals
 * live in `./crm-modals`.
 */

export const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(value);

const KPI_ICONS = [
  <BriefcaseBusiness />,
  <Clock3 />,
  <ClipboardCheck />,
  <CircleDollarSign />,
  <Star />,
  <Users />,
  <Target />,
  <CalendarCheck />,
];

/** One KPI card row — keep 4–6 cards per the dashboard guidelines. */
export function KpiStrip({
  label,
  items,
}: {
  label: string;
  items: Array<[string, string, string]>;
}) {
  return (
    <section className="kpi-strip" aria-label={label}>
      {items.map(([cardLabel, value, note], index) => (
        <article key={cardLabel}>
          <div className="kpi-icon">{KPI_ICONS[index % KPI_ICONS.length]}</div>
          <div>
            <span>{cardLabel}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        </article>
      ))}
    </section>
  );
}

/** ISO instant from `<input type=date>` + `<input type=time>` (device local). */
export function stampFrom(date: string, time: string): string | null {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
