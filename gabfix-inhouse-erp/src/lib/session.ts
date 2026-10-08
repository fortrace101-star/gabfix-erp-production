import { useEffect, useState } from "react";
import { portalApi, type EmployeeSession } from "@/lib/api";

/**
 * Live-data slice (plan A6): resolves the signed-in employee from the server
 * (GET /auth/me, fresh from the DB) for the portal shell's identity surfaces.
 *
 * `loading` is true until that first answer lands — the shell uses it to hold a
 * neutral "restoring session" screen instead of guessing at an identity (the
 * tokens live in localStorage, so SSR cannot know who is signed in).
 */
export function useSession(): { session: EmployeeSession | null; loading: boolean } {
  const [session, setSession] = useState<EmployeeSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    portalApi.auth.me().then((user) => {
      if (!alive) return;
      setSession(user);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { session, loading };
}
