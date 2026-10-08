import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { apiClient, type InviteCode } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Tone = "default" | "secondary" | "destructive" | "outline";

/** Read-only table of issued invite codes with status badges + admin actions. */
export function InviteCodeList({ refreshKey }: { refreshKey?: number }) {
  const [codes, setCodes] = useState<InviteCode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setCodes(await apiClient.invites.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load account creation codes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshKey]);

  async function revoke(c: InviteCode) {
    try {
      await apiClient.invites.revoke(c.code);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke invite");
    }
  }

  async function remove(c: InviteCode) {
    try {
      await apiClient.invites.remove(c.code);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete invite");
    }
  }

  function classify(c: InviteCode): { label: string; tone: Tone } {
    if (c.revokedAt) return { label: "revoked", tone: "destructive" };
    if (c.usedAt) return { label: "used", tone: "secondary" };
    if (new Date(c.expiresAt).getTime() <= Date.now()) return { label: "expired", tone: "outline" };
    return { label: "active", tone: "default" };
  }

  return (
    <section className="mb-6">
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {!codes && loading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto size-4 animate-spin" /> Loading codes…
        </div>
      )}

      {!codes && !loading && <p className="text-sm text-muted-foreground">Loading account creation codes…</p>}

      {codes?.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No account creation codes yet.</p>
      )}

      {codes && codes.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">Code</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Apps</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
                <th className="px-3 py-2 text-left font-medium">Used by</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {codes.map((c) => {
                const { label, tone } = classify(c);
                const revocable =
                  !c.usedAt && !c.revokedAt && new Date(c.expiresAt).getTime() > Date.now();
                return (
                  <tr key={c.code} className="align-top">
                    <td className="px-3 py-2 font-mono">{c.code}</td>
                    <td className="px-3 py-2">{c.role}</td>
                    <td className="px-3 py-2">{c.appScope.join(", ")}</td>
                    <td className="px-3 py-2">
                      <Badge variant={tone}>{label}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {c.usedAt
                        ? `${c.usedBy ?? "—"} on ${new Date(c.usedAt).toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {revocable ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => revoke(c)}>
                            Revoke
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => remove(c)}>
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {loading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto size-4 animate-spin" /> Loading codes…
        </div>
      )}
    </section>
  );
}
