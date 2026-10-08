import { useEffect, useState } from "react";
import { apiClient, type StaffSession } from "@/lib/api";

/** Live-data slice (plan A6): resolves the signed-in admin from the server
 *  (GET /auth/me, fresh from the DB) for the admin console's identity
 *  surfaces (topbar profile + greeting). */
export function useSession(): StaffSession | null {
  const [session, setSession] = useState<StaffSession | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient.auth.me().then((user) => {
      if (alive) setSession(user);
    });
    return () => {
      alive = false;
    };
  }, []);

  return session;
}
