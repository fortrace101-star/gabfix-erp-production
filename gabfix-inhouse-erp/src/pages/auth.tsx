import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { portalApi } from "@/lib/api";
import { useDocumentTitle } from "@/lib/use-document-title";

export default function AuthPage() {
  useDocumentTitle("Employee sign in — Gabfix Portal", "Secure employee access to Gabfix Portal.");
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Return the employee to the page they originally requested (set by
  // ProtectedRoute), accepting only internal paths to prevent open redirects.
  const from = (location.state as { from?: string } | null)?.from;
  const redirectTarget = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      await portalApi.auth.login(identifier, password);
      navigate(redirectTarget, { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <img src="/gabfix-logo.png" alt="Gabfix" />
        <div>
          <p>GABFIX HOME SOLUTIONS</p>
          <h1>
            Work made clear.
            <br />
            Service made better.
          </h1>
          <span>Your day, jobs and team—together in one secure workspace.</span>
        </div>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={signIn}>
          <div className="auth-logo">
            <img src="/gabfix-logo.png" alt="Gabfix" />
            <strong>Gabfix Portal</strong>
          </div>
          <div>
            <p>EMPLOYEE ACCESS</p>
            <h2>Welcome back</h2>
            <span>
              Sign in with your Gabfix work account. Accounts are issued by the Admin Console.
            </span>
          </div>
          <label>
            Name or email
            <input
              type="text"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Grace Atim"
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <div className="password">
              <input
                type={show ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShow(!show)}
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </label>
          {message && <p className="auth-error">{message}</p>}
          <Button className="w-full" size="lg" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : "Sign in"}
          </Button>
          <small>Access is limited to authorised Gabfix employees.</small>
        </form>
      </section>
    </main>
  );
}
