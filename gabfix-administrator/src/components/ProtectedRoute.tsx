import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { apiClient } from "@/lib/api";

/**
 * Guards admin pages: without a stored API token the visitor is redirected to
 * the sign-in page, preserving the attempted location for post-login redirect.
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();

  if (!apiClient.auth.isAuthenticated()) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }
  return children;
}
