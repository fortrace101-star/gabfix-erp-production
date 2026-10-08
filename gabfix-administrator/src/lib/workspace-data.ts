import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api";

/**
 * Live workspace reads for the admin pages (single fetch, shared shape).
 * Every page re-fetches on demand after a modal mutation completes.
 */

export type Workspace = {
  customers: Array<{ id: string; name: string; company: string; type: string; phone: string; email: string; balance: number; status: string }>;
  jobs: Array<{ id: string; number: string; customerId: string; serviceId: string; date: string; status: string; revenue: number; cost: number; assignees: string[] }>;
  services: Array<{ id: string; name: string; division: string; method: string; price: number; active: boolean }>;
  invoices: Array<{ id: string; number: string; customerId: string; date: string; due: string; total: number; paid: number; status: string }>;
  expenses: Array<{ id: string; category: string; description: string; amount: number; date: string; division: string }>;
  laundry: Array<{ id: string; number: string; customerId: string; status: string; total: number; paid: number; received: string }>;
  equipment: Array<{ id: string; name: string; serialNumber: string; type: string; value: number; bookValue: number; condition: string; purchaseDate: string }>;
  inventory: Array<{ id: string; name: string; category: string; unit: string; quantity: number; minimum: number; cost: number; code: string | null; kind: string }>;
  payments: Array<{ id: string; number: string; amount: number; methodId: string | null; invoiceId: string | null; laundryOrderId: string | null; status: string; receivedAt: string }>;
  suppliers: Array<{ id: string; name: string; phone: string; contact: string | null; categories: string | null; spendYtd: number | null; rating: string | null }>;
  purchaseRequests: Array<{ id: string; description: string; qty: number; supplierId: string | null; value: number; requestedBy: string; requestedOn: string; status: string }>;
  utilityCaptures: Array<{ id: string; capturedOn: string; type: string; reference: string; reading: string; amount: number; categoryKind: string; capturedBy: string; status: string; expenseId: string | null }>;
};

export function useWorkspaceData() {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    apiClient
      .get<Workspace>("/data")
      .then((ws) => {
        setData(ws);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load workspace"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, error, refresh };
}

/** SSE → refresh mapping for the admin console (cross-app fabric, F1 for admin). */
export function useWorkspaceSse(onEvent: () => void) {
  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    if (!base || typeof EventSource === "undefined") return;
    const token = localStorage.getItem("gabfix-admin:auth-token");
    const url = token ? `${base}/events?access_token=${encodeURIComponent(token)}` : `${base}/events`;
    const es = new EventSource(url);
    for (const type of [
      "job-created", "job-updated", "customer-created", "expense-created",
      "equipment-created", "equipment-updated", "inventory-created", "inventory-updated",
      "payment-created", "laundry-updated", "purchase-created", "purchase-approved",
      "store-updated", "workspace-reset", "employees-updated", "settings-updated", "expense-created",
    ]) {
      es.addEventListener(type, onEvent);
    }
    return () => es.close();
  }, [onEvent]);
}
