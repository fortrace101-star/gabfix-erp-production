import { type Filing } from "@/lib/filings";
import { addDays, kampalaDayKey, startOfWeek } from "@/lib/timesheet";

export type Role = "Technician" | "Sales" | "Supervisor" | "Accountant-field" | "CSR";
export type JobStatus = "Scheduled" | "Started" | "Completed" | "Invoiced";
export type Job = {
  id: string;
  title: string;
  customer: string;
  location: string;
  time: string;
  status: JobStatus;
  priority: "High" | "Normal";
  value: string;
  crew: string;
};

export const jobs: Job[] = [
  {
    id: "GF-2841",
    title: "Kitchen tap replacement",
    customer: "Sarah Nanyonga",
    location: "Muyenga, Kampala",
    time: "09:00",
    status: "Started",
    priority: "High",
    value: "UGX 285K",
    crew: "Field Crew A",
  },
  {
    id: "GF-2846",
    title: "Bathroom inspection",
    customer: "Mark Kato",
    location: "Ntinda, Kampala",
    time: "12:30",
    status: "Scheduled",
    priority: "Normal",
    value: "UGX 120K",
    crew: "Field Crew A",
  },
  {
    id: "GF-2852",
    title: "Water heater service",
    customer: "Acacia Residences",
    location: "Kololo, Kampala",
    time: "15:00",
    status: "Scheduled",
    priority: "Normal",
    value: "UGX 640K",
    crew: "Field Crew B",
  },
  {
    id: "GF-2833",
    title: "Drainage repair",
    customer: "Nile Avenue Offices",
    location: "Central Kampala",
    time: "Yesterday",
    status: "Completed",
    priority: "High",
    value: "UGX 950K",
    crew: "Field Crew A",
  },
];

export const roleCopy: Record<Role, { eyebrow: string; title: string; subtitle: string }> = {
  Technician: {
    eyebrow: "Monday, 28 September",
    title: "Good afternoon, Daniel",
    subtitle: "You have three jobs scheduled today. One needs attention.",
  },
  Sales: {
    eyebrow: "Sales workspace",
    title: "Your pipeline is moving",
    subtitle: "Two quotes need follow-up before the end of the day.",
  },
  Supervisor: {
    eyebrow: "Field Crew A",
    title: "Crew day overview",
    subtitle: "Six technicians are active across four customer sites.",
  },
  "Accountant-field": {
    eyebrow: "Field costs",
    title: "Capture today's expenses",
    subtitle: "Submit direct job costs and sales expenses for approval.",
  },
  CSR: {
    eyebrow: "Customer support",
    title: "Customer requests and follow-ups",
    subtitle: "Manage leads, service requests, and customer feedback.",
  },
};

/**
 * Sample cost lines for the Costs board before the API answers — the demo-first
 * contract shared with `jobs` above: the board paints KPIs, week bars and rows
 * immediately, and `GET /api/employees/my-filings` replaces them once its first
 * response lands (`useMyFilings().loaded`).
 *
 * Days anchor to the current Kampala week: line 0 always lands on today, the
 * next four spread across the elapsed weekdays (Monday → today) and the last
 * two sit in the previous week — so the strip and KPIs have something to show
 * whatever weekday it is. Today's lines are clamped to the current wall clock
 * so the table never shows a future time.
 */
export function demoCostLines(now: Date = new Date()): Filing[] {
  const today = kampalaDayKey(now);
  const monday = startOfWeek(today);
  const thisWeek: string[] = [];
  for (let day = today; day >= monday; day = addDays(day, -1)) thisWeek.push(day);

  // Africa/Kampala runs UTC+3 all year (no DST), so the clamp is pure arithmetic.
  const capHour = (now.getUTCHours() + 3) % 24;
  const capMinute = now.getUTCMinutes();
  const clamp = (hour: number, minute: number, isToday: boolean): [number, number] => {
    if (!isToday || hour < capHour) return [hour, minute];
    if (hour > capHour || (hour === capHour && minute > capMinute)) return [capHour, capMinute];
    return [hour, minute];
  };
  const at = (day: string, hour: number, minute: number): string =>
    new Date(
      `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`,
    ).toISOString();

  const templates: Array<{
    job: string;
    description: string;
    qty?: number;
    unitCost?: number;
    amount?: number;
    hour: number;
    minute: number;
  }> = [
    {
      job: "GF-2841",
      description: "Copper pipes + elbows (15mm)",
      qty: 6,
      unitCost: 12_500,
      hour: 9,
      minute: 20,
    },
    {
      job: "GF-2852",
      description: "Heater element (3kW) + thermostat",
      qty: 1,
      unitCost: 87_500,
      hour: 11,
      minute: 5,
    },
    {
      job: "GF-2846",
      description: "PVC solvent cement + primer",
      qty: 2,
      unitCost: 18_500,
      hour: 14,
      minute: 40,
    },
    {
      job: "GF-2841",
      description: "Boda fare — parts run to Nakasero",
      amount: 9_000,
      hour: 16,
      minute: 15,
    },
    {
      job: "GF-2833",
      description: "Grab hire — drainage spoil removal",
      amount: 320_000,
      hour: 10,
      minute: 30,
    },
    {
      job: "GF-2852",
      description: "Subcontract — electrician, half day",
      amount: 150_000,
      hour: 13,
      minute: 10,
    },
    {
      job: "GF-2841",
      description: "Thread seal tape + fittings sundries",
      qty: 4,
      unitCost: 3_500,
      hour: 8,
      minute: 45,
    },
  ];

  return templates.map((template, index) => {
    // Lines 0–4 share this week (today first); lines 5–6 sit in the last one.
    const isLastWeek = index >= 5;
    const day =
      (isLastWeek ? addDays(monday, index === 5 ? -1 : -2) : thisWeek[index % thisWeek.length]) ??
      today;
    const [hour, minute] = clamp(template.hour, template.minute, !isLastWeek && day === today);
    const row: Filing = {
      id: 9001 + index,
      jobId: template.job,
      jobNumber: template.job,
      description: template.description,
      createdAt: at(day, hour, minute),
    };
    if (typeof template.amount === "number") row.amount = template.amount;
    if (typeof template.qty === "number") row.qty = template.qty;
    if (typeof template.unitCost === "number") row.unitCost = template.unitCost;
    return row;
  });
}
