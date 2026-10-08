import { useState, type FormEvent } from "react";
import { Copy, Plus } from "lucide-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SCOPES = ["admin", "laundry", "portal", "store"] as const;
// Mirrors the server's INVITE_ROLES (server/routes/invites.ts) — keep in step.
const ROLES = ["manager", "sales", "technician", "laundry", "accountant", "storekeeper", "csr"] as const;

/**
 * Staff & Access: the "Generate account creation code" dialog.
 * Admin issues a single-use invite code (role + app scopes + expiry); the new
 * hire consumes it on their app shell via the public sign-up flow. The granted
 * scope can never be escalated client-side — the code is the ceiling.
 */
export function StaffAccessModal({ onGenerated }: { onGenerated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>("storekeeper");
  const [appScope, setAppScope] = useState<string[]>(["store"]);
  const [expiresInHours, setExpiresInHours] = useState<string>("48");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);

  function toggleScope(scope: string) {
    setAppScope((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const hours = Number(expiresInHours);
    if (!appScope.length) {
      setError("Grant at least one app scope.");
      return;
    }
    if (!Number.isInteger(hours) || hours < 1) {
      setError("Expiry must be a whole number of hours.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const created = await apiClient.invites.create({
        role,
        app_scope: appScope,
        expiresInHours: hours,
      });
      setGenerated(created.code);
      onGenerated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create invite");
    } finally {
      setSubmitting(false);
    }
  }

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          Generate account creation code
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate account creation code</DialogTitle>
        </DialogHeader>
        {generated ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share this account creation code with your new hire — they sign up with it to create their account, and the role and apps you picked are baked into the code. It is single-use and cannot be reused
              consumed.
            </p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-2xl font-bold tracking-widest">{generated}</code>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copy code"
                onClick={() => copyCode(generated)}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setGenerated(null);
                setOpen(false);
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="invite-role">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>App scopes</Label>
              <div className="flex flex-wrap gap-3">
                {SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={appScope.includes(s)}
                      onCheckedChange={() => toggleScope(s)}
                    />
                    {s}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Grant the app scopes the hire should reach. Only the workspace owner may grant the
                admin-console scope.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-expiry">Expires in (hours)</Label>
              <Input
                id="invite-expiry"
                type="number"
                min={1}
                max={168}
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !appScope.length}>
                {submitting ? "Generating…" : "Create account code"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
