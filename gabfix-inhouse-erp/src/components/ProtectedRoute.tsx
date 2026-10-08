import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { portalApi } from "@/lib/api";

/**
 * Guards employee-only pages: without a stored API token the visitor is
 * redirected to the sign-in page, preserving the attempted location.
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();

  if (!portalApi.auth.isAuthenticated()) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }
  return children;
}
