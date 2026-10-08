import { portalApi } from "@/lib/api";

/**
 * Order lifecycle (plan P1) for the portal: a salesperson raises a proposal,
 * the server mints the job number and a tokenised share link, and a manager
 * later confirms it by phone. Mirrors `server/routes/orders.ts`.
 */
export const JOB_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

/** Provenance of a portal-entered order (server default: `salesperson`). */
export type OrderSource = "website" | "salesperson" | "admin" | "other";

export type ProposalInput = {
  customerId: string;
  serviceId: string;
  date: string;
  revenue?: number | undefined;
  priority?: JobPriority | undefined;
  siteAddress?: string | undefined;
  source?: OrderSource | undefined;
};

export type ProposalCreated = {
  id: string;
  number: string;
  status: string;
  source: string;
};

export type SharedProposal = { shareToken: string; shareUrl: string };

/** POST /api/orders/proposals — creates a `Proposed` job (capability-gated). */
export async function createProposal(input: ProposalInput): Promise<ProposalCreated> {
  return portalApi.request<ProposalCreated>("/orders/proposals", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** POST /api/orders/:id/share — mints (or reuses) the WhatsApp share token. */
export async function shareProposal(id: string): Promise<SharedProposal> {
  return portalApi.request<SharedProposal>(`/orders/${id}/share`, { method: "POST" });
}

/**
 * The server returns `/proposal/:token` (mounted at its root, outside `/api`),
 * so expand it against the API origin before pasting into WhatsApp.
 */
export function absoluteShareUrl(shareUrl: string): string {
  const base = (portalApi.baseUrl || "").replace(/\/api\/?$/, "");
  return `${base}${shareUrl}`;
}
