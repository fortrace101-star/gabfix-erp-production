import { useEffect, useState, type FormEvent } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { portalApi, type InviteValidation } from "@/lib/api";
import { useDocumentTitle } from "@/lib/use-document-title";

const LOGO_SRC = "/gabfix-logo.png";

/**
 * Portal sign-up — the invite-code-keyed account creation flow.
 *
 * The Admin Console's "Generate account creation code" dialog (StaffAccessModal)
 * bakes a role + app scopes into a single-use code. This page resolves the code
 * first, shows the grants exactly as preset, then creates the account with
 * EXACTLY those grants (server enforces the ceiling — the form cannot escalate).
 */
export default function SignUpPage() {
  useDocumentTitle(
    "Create your account — Gabfix Portal",
    "Sign up with the invite code issued by the Gabfix Admin Console.",
  );
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [invite, setInvite] = useState<InviteValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");

  // Already signed in (e.g. right after a successful sign-up) → go to the workspace.
  useEffect(() => {
    if (portalApi.auth.isAuthenticated()) void router.navigate({ to: "/" });
  }, [router]);

  async function validateCode(e: FormEvent) {
    e.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (code.length < 3) {
      setCodeError("Enter the invite code from your Admin.");
      return;
    }
    setValidating(true);
    setCodeError("");
    try {
      const res = await portalApi.auth.validateInvite(code);
      if (res.valid) setInvite(res);
      else setCodeError("That code is not valid.");
    } catch {
      setCodeError("Invalid, expired, or already-used code.");
    } finally {
      setValidating(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    if (!invite) {
      setMessage("Validate your invite code first.");
      return;
    }
    if (form.name.trim().length < 2) {
      setMessage("Enter your full name.");
      return;
    }
    if (form.password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await portalApi.auth.signUp({
        inviteCode: inviteCode.trim().toUpperCase(),
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      await router.navigate({ to: "/" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create account.");
    } finally {
      setSubmitting(false);
    }
  }

  const missingPortal = invite !== null && !invite.app_scope.includes("portal");
  const errorBox =
    "mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive";

  return (
    <main className="signin">
      <div className="signin-brand">
        <div className="signin-logo">
          <img src={LOGO_SRC} alt="Gabfix" />
          <strong>
            Gabfix <small>EMPLOYEE PORTAL</small>
          </strong>
        </div>
        <div>
          <p className="eyebrow">GABFIX HOME SOLUTIONS</p>
          <h1>
            Work made clear.
            <br />
            Service made better.
          </h1>
          <p>One workspace for every job, every customer, every day.</p>
        </div>
        <small>Kampala, Uganda</small>
      </div>
      <div className="signin-side">
        {!invite ? (
          <form onSubmit={validateCode} className="signin-form">
            <p className="eyebrow">ACCOUNT CREATION</p>
            <h2>Create your account</h2>
            <p>
              Enter the invite code your Admin issued. Your role and app access are preset by the
              code — you cannot add apps yourself.
            </p>
            <label>
              Invite code
              <input
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="e.g. F2PEWYZC"
                minLength={3}
                autoComplete="one-time-code"
                style={{ textTransform: "uppercase" }}
              />
            </label>
            {codeError && <p className={errorBox}>{codeError}</p>}
            <Button type="submit" className="signin-submit" disabled={validating}>
              {validating ? <LoaderCircle className="mr-1 inline size-4 animate-spin" /> : null}
              {validating ? "Checking…" : "Continue"}
            </Button>
            <small>
              Already have an account?{" "}
              <Link to="/" className="font-semibold text-primary hover:underline">
                Sign in
              </Link>
            </small>
          </form>
        ) : (
          <form onSubmit={submit} className="signin-form">
            <p className="eyebrow">GRANTED BY YOUR CODE</p>
            <h2>Create your account</h2>
            <div className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs">
              <p className="font-semibold uppercase tracking-wider text-primary">Access</p>
              <p className="mt-1">
                Role: <strong>{invite.role}</strong>
              </p>
              <p>
                Apps: <strong>{invite.app_scope.join(", ") || "none"}</strong>
              </p>
              <p className="mt-1 text-muted-foreground">
                Fixed by your code — you cannot change it here.
                {invite.expires_at ? ` Expires ${new Date(invite.expires_at).toLocaleString()}.` : ""}
              </p>
            </div>
            {missingPortal && (
              <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                This code does not include the Portal app. The account will be created, but it will
                not open the Portal workspace until an Admin grants it.
              </p>
            )}
            <label>
              Full name
              <input
                required
                minLength={2}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Grace Atim"
                autoComplete="name"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="grace@home.local"
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <span className="password-field">
                <input
                  required
                  minLength={6}
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={showPassword ? "Hide password" : "Show password"}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </Button>
              </span>
            </label>
            {message && <p className={errorBox}>{message}</p>}
            <Button type="submit" className="signin-submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="mr-1 inline size-4 animate-spin" /> : null}
              {submitting ? "Creating account…" : "Create account"}
            </Button>
            <small>
              Wrong code?{" "}
              <button
                type="button"
                onClick={() => {
                  setInvite(null);
                  setCodeError("");
                }}
                className="font-semibold text-primary hover:underline"
              >
                Use a different code
              </button>
            </small>
          </form>
        )}
      </div>
    </main>
  );
}