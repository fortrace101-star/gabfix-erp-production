/**
 * Typed fetch client for the Gabfix API (admin control plane).
 *
 * Reads VITE_API_BASE_URL at build time (set in .env). If unset the client is
 * marked as unconfigured and request() throws with a helpful message.
 * Canonical auth contract: POST /auth/login → {accessToken, refreshToken, user}.
 */

import type { RequestLog } from "@/lib/types";

const ACCESS_TOKEN_KEY = "gabfix-admin:auth-token";
const REFRESH_TOKEN_KEY = "gabfix-admin:refresh-token";
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const APP_ID = import.meta.env.VITE_APP_ID ?? "admin";

/** Employee identity returned by the server API after login (canonical shape). */
export type StaffSession = {
  id: string;
  name: string;
  role: string;
  app_scope: string[];
};

/** An invite code row as surfaced by the Admin Console's Staff & Access panel. */
export type InviteCode = {
  code: string;
  role: string;
  appScope: string[];
  expiresAt: string;
  createdAt: string;
  usedBy: string | null;
  usedAt: string | null;
  revokedAt: string | null;
};

type TokenPair = { accessToken: string; refreshToken: string; user: StaffSession };

function headersWithAuth(extra?: Record<string, string>): Record<string, string> {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    "X-App-Id": APP_ID,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function parseError(response: Response): Promise<never> {
  const body = await response.text().catch(() => "");
  throw new Error(`API request failed (${response.status}): ${body}`);
}

export const apiClient = {
  baseUrl: BASE_URL,
  isConfigured: Boolean(BASE_URL),

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!BASE_URL) throw new Error("The Gabfix API is not configured (set VITE_API_BASE_URL).");
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: headersWithAuth(init?.headers as Record<string, string> | undefined),
    });
    if (!response.ok) await parseError(response);
    return response.json() as Promise<T>;
  },

  /** Authenticated GET that transparently refreshes once on 401 before failing. */
  async get<T>(path: string): Promise<T> {
    if (!BASE_URL) throw new Error("The Gabfix API is not configured (set VITE_API_BASE_URL).");
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return this.request<T>(path);
    const probe = await fetch(`${BASE_URL}${path}`, { headers: headersWithAuth() });
    if (probe.status !== 401) {
      if (!probe.ok) await parseError(probe);
      return probe.json() as Promise<T>;
    }
    const refreshed = await this.auth.refresh();
    if (!refreshed) await parseError(probe);
    const retry = await fetch(`${BASE_URL}${path}`, { headers: headersWithAuth() });
    if (!retry.ok) await parseError(retry);
    return retry.json() as Promise<T>;
  },

  auth: {
    async login(identifier: string, password: string): Promise<StaffSession> {
      const body = await apiClient.request<TokenPair>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      localStorage.setItem(ACCESS_TOKEN_KEY, body.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, body.refreshToken);
      return body.user;
    },

    /** Exchanges the stored refresh token for a fresh pair; null when expired. */
    async refresh(): Promise<StaffSession | null> {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken || !BASE_URL) return null;
      try {
        const response = await fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-App-Id": APP_ID },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) {
          apiClient.auth.signOut();
          return null;
        }
        const body = (await response.json()) as TokenPair;
        localStorage.setItem(ACCESS_TOKEN_KEY, body.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, body.refreshToken);
        return body.user;
      } catch {
        return null;
      }
    },

    async me(): Promise<StaffSession | null> {
      try {
        const body = await apiClient.request<{ user: StaffSession }>("/auth/me");
        return body.user;
      } catch {
        return null;
      }
    },

    async signOut(): Promise<void> {
      try {
        await apiClient.request("/auth/logout", { method: "POST", body: JSON.stringify({}) });
      } catch {
        /* stateless tokens: discarding them locally is always sufficient */
      }
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    },

    isAuthenticated() {
      return Boolean(localStorage.getItem(ACCESS_TOKEN_KEY));
    },
  },

  /**
   * Staff & Access invite-code management (admin console).
   * `POST /api/invites` is owner/manager-guarded at the route; the admin-scope
   * ceiling (only owner may grant `admin`) is enforced server-side too.
   */
  invites: {
    list: () => apiClient.get<InviteCode[]>("/invites"),
    create: (body: { role: string; app_scope: string[]; expiresInHours?: number }) =>
      apiClient.request<InviteCode>("/invites", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    revoke: (code: string) =>
      apiClient.request<{ ok: boolean }>(`/invites/${encodeURIComponent(code)}/revoke`, {
        method: "PATCH",
      }),
    remove: (code: string) =>
      apiClient.request<{ ok: boolean }>(`/invites/${encodeURIComponent(code)}`, {
        method: "DELETE",
      }),
  },
};

export async function fetchLogs(
  params?: Record<string, string | number | undefined>,
): Promise<RequestLog[]> {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
  }
  const path = qs.toString() ? `/logs?${qs.toString()}` : "/logs";
  return apiClient.request<RequestLog[]>(path);
}
