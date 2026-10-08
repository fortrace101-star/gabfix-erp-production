const ACCESS_TOKEN_KEY = "gabfix:auth-token";
const REFRESH_TOKEN_KEY = "gabfix:refresh-token";

/** Employee identity returned by the server API after login (canonical shape). */
export type EmployeeSession = {
  id: string;
  name: string;
  role: string;
  app_scope: string[];
};

/** Result of validating an invite code on the public sign-up flow. */
export type InviteValidation = {
  valid: boolean;
  role: string;
  app_scope: string[];
  expires_at: string;
};

type TokenPair = { accessToken: string; refreshToken: string; user: EmployeeSession };

function headersWithAuth(): Record<string, string> {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    "X-App-Id": APP_ID,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const BASE_URL = import.meta.env["VITE_API_BASE_URL"] ?? "";
const APP_ID = import.meta.env["VITE_APP_ID"] ?? "portal";

async function parseError(response: Response): Promise<never> {
  const body = await response.text().catch(() => "");
  // Prefer the server's structured { error } message so UIs show plain English.
  let message = `Gabfix API request failed (${response.status}): ${body}`;
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed?.error === "string" && parsed.error) message = parsed.error;
    } catch {
      /* not JSON — keep the raw body */
    }
  }
  throw new Error(message);
}

export const portalApi = {
  baseUrl: BASE_URL,
  appId: APP_ID,
  isConfigured: Boolean(BASE_URL),

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!BASE_URL) throw new Error("The Gabfix API is not configured yet (set VITE_API_BASE_URL).");
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...headersWithAuth(),
        ...init?.headers,
      },
    });
    if (!response.ok) await parseError(response);
    return response.json() as Promise<T>;
  },

  /** Authenticated GET that transparently refreshes once on 401 before failing. */
  async get<T>(path: string): Promise<T> {
    if (!BASE_URL) throw new Error("The Gabfix API is not configured yet (set VITE_API_BASE_URL).");
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

  /**
   * Employee authentication against the Gabfix server API.
   * Canonical contract: POST /api/auth/login → {accessToken, refreshToken, user}.
   * Staff accounts are created through the invite-code sign-up flow: an Admin issues a single-use code (see `signUp`), and the code's role + app scopes are the ceiling.
   */
  auth: {
    async login(identifier: string, password: string): Promise<EmployeeSession> {
      const body = await portalApi.request<TokenPair>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      localStorage.setItem(ACCESS_TOKEN_KEY, body.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, body.refreshToken);
      return body.user;
    },

    /** Validates an Admin-issued invite code for the public sign-up flow. */
    validateInvite(code: string): Promise<InviteValidation> {
      return portalApi.request<InviteValidation>(`/auth/invites/${encodeURIComponent(code)}/validate`);
    },
    /**
     * Consumes a valid invite code to create an account with EXACTLY the role +
     * app scopes granted by the code, then stores the issued token pair (same as
     * `login`) so the new hire lands inside an authenticated session.
     */
    async signUp(payload: {
      inviteCode: string;
      name: string;
      email: string;
      password: string;
    }): Promise<EmployeeSession> {
      const body = await portalApi.request<TokenPair>("/auth/sign-up", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      localStorage.setItem(ACCESS_TOKEN_KEY, body.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, body.refreshToken);
      return body.user;
    },
    /** Exchanges the stored refresh token for a fresh pair; null when expired. */
    async refresh(): Promise<EmployeeSession | null> {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken || !BASE_URL) return null;
      try {
        const response = await fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-App-Id": APP_ID },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) {
          portalApi.auth.signOut();
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

    async me(): Promise<EmployeeSession | null> {
      try {
        const body = await portalApi.request<{ user: EmployeeSession }>("/auth/me");
        return body.user;
      } catch {
        return null;
      }
    },

    async signOut(): Promise<void> {
      try {
        await portalApi.request("/auth/logout", { method: "POST", body: JSON.stringify({}) });
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
};
