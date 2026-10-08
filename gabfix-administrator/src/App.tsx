import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { AdminDashboard } from "@/components/admin-dashboard";
import { RequestLogsPage } from "@/components/RequestLogsPage";
import { EmployeesPage } from "@/components/EmployeesPage";
import { PermissionMatrixPage } from "@/components/PermissionMatrixPage";
import { SettingsPage } from "@/components/SettingsPage";
import { DispatchPage } from "@/components/DispatchPage";
import { FinancePage } from "@/components/FinancePage";
import { CustomersPage } from "@/components/CustomersPage";
import { DevicesPage } from "@/components/DevicesPage";
import { AssetsPage, InventoryPage, MessagesPage, SyncHealthPage } from "@/components/OpsPages";
import ProtectedRoute from "@/components/ProtectedRoute";
import { registerAdminServiceWorker } from "@/lib/pwa";

const AuthPage = lazy(() => import("@/pages/auth"));

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              This page didn't load
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Something went wrong on our end. You can try refreshing or head back home.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => this.setState({ error: null })}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Try again
              </button>
              <a
                href="/"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Go home
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Bridges the prototype's page-state navigation to real routes (Phase B1 refactors). */
function DashboardPage() {
  const navigate = useNavigate();
  return (
    <AdminDashboard
      onNavigate={(page) =>
        navigate(
          page === "logs"
            ? "/logs"
            : page === "employees"
              ? "/employees"
              : page === "settings"
                ? "/settings"
                : page === "dispatch"
                  ? "/dispatch"
                  : page === "finance"
                    ? "/finance"
                    : page === "customers"
                      ? "/customers"
                      : page === "devices"
                        ? "/devices"
                        : page === "inventory"
                          ? "/inventory"
                          : page === "assets"
                            ? "/assets"
                            : page === "messages"
                              ? "/messages"
                              : page === "sync-health"
                                ? "/sync-health"
                                : "/",
        )
      }
    />
  );
}

function LogsPage() {
  return <RequestLogsPage onBack={() => window.history.back()} />;
}

function EmployeesRoute() {
  return <EmployeesPage onBack={() => window.history.back()} />;
}

function PermissionMatrixRoute() {
  return <PermissionMatrixPage onBack={() => window.history.back()} />;
}

function SettingsRoute() {
  return <SettingsPage onBack={() => window.history.back()} />;
}

const back = () => window.history.back();

export default function App() {
  void registerAdminServiceWorker();

  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/logs"
              element={
                <ProtectedRoute>
                  <LogsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/employees"
              element={
                <ProtectedRoute>
                  <EmployeesRoute />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <SettingsRoute />
                </ProtectedRoute>
              }
            />
            <Route path="/dispatch" element={<ProtectedRoute><DispatchPage onBack={back} /></ProtectedRoute>} />
            <Route path="/finance" element={<ProtectedRoute><FinancePage onBack={back} /></ProtectedRoute>} />
            <Route path="/customers" element={<ProtectedRoute><CustomersPage onBack={back} /></ProtectedRoute>} />
            <Route path="/devices" element={<ProtectedRoute><DevicesPage onBack={back} /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><InventoryPage onBack={back} /></ProtectedRoute>} />
            <Route path="/assets" element={<ProtectedRoute><AssetsPage onBack={back} /></ProtectedRoute>} />
            <Route path="/permission-matrix" element={<ProtectedRoute><PermissionMatrixRoute /></ProtectedRoute>} />
            <Route path="/messages" element={<ProtectedRoute><MessagesPage onBack={back} /></ProtectedRoute>} />
            <Route path="/sync-health" element={<ProtectedRoute><SyncHealthPage onBack={back} /></ProtectedRoute>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
