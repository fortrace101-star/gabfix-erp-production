import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocumentTitle } from "@/lib/use-document-title";

export default function AuthPage() {
  useDocumentTitle(
    "Sign in — Gabfix Admin Console",
    "Control-plane access: staff, app scopes, dashboards, and request logs.",
  );
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Return the admin to the page they originally requested (set by
  // ProtectedRoute), accepting only internal paths to prevent open redirects.
  const from = (location.state as { from?: string } | null)?.from;
  const redirectTarget = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  useEffect(() => {
    if (apiClient.auth.isAuthenticated()) {
      navigate(redirectTarget, { replace: true });
    }
  }, [navigate, redirectTarget]);

  // Owner/admin accounts are seeded (OWNER_PASSWORD) or created in this console.
  // There is no self sign-up — the Admin Console is the access-control apex.
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    setMessage("");
    const identifier = String(formData.get("identifier"));
    const password = String(formData.get("password"));
    try {
      await apiClient.auth.login(identifier, password);
      navigate(redirectTarget, { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-background md:grid-cols-[minmax(0,1fr)_520px]">
      <section className="hidden flex-col justify-between p-12 md:flex">
        <div className="flex items-center gap-3">
          <img src="/gabfix-logo.png" className="h-14 w-14" alt="Gabfix" />
          <div>
            <p className="text-xl font-bold">Gabfix</p>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Admin Console
            </p>
          </div>
        </div>
        <div className="max-w-xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-widest text-primary">
            Control plane
          </p>
          <h1 className="text-5xl font-bold leading-tight">
            One console.
            <br />
            Every app accounted for.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            Staff accounts, app scopes, dashboards, and the request log — the apex of the Gabfix
            suite.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Gabfix Home Solutions · Kampala</p>
      </section>

      <section className="flex items-center justify-center border-l border-border bg-card p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 md:hidden">
            <img src="/gabfix-logo.png" className="h-12 w-12" alt="Gabfix" />
            <strong>Gabfix Admin</strong>
          </div>
          <p className="text-sm font-semibold text-primary">ADMIN ACCESS</p>
          <h2 className="mt-2 text-3xl font-bold">Welcome back</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use your authorised Gabfix account to continue.
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Name or email</span>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="identifier"
                  required
                  className="pl-9"
                  placeholder="Grace Atim"
                  autoComplete="username"
                />
              </div>
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Password</span>
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="password"
                  type={show ? "text" : "password"}
                  required
                  className="px-9"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            {message && (
              <p className="rounded-md border border-border bg-muted p-3 text-sm">{message}</p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? <LoaderCircle className="animate-spin" /> : null}
              Sign in
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
