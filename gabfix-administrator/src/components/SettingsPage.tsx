import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api";
import { useDocumentTitle } from "@/lib/use-document-title";

type Settings = {
  companyName: string;
  companyTagline: string;
  companyPhone: string;
  companyAddress: string;
  currency: string;
  taxBasis: string;
  whatsappEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  appreciationDelayHours: number;
  feedbackRetentionDays: number;
  pushEnabled: boolean;
  vapidPublicKey: string;
};

const FLAGS: Array<{ key: keyof Settings; label: string; hint: string }> = [
  { key: "whatsappEnabled", label: "WhatsApp", hint: "Send appreciation + feedback via WhatsApp (needs credentials)" },
  { key: "smsEnabled", label: "SMS", hint: "Fallback text channel (Africa's Talking)" },
  { key: "emailEnabled", label: "Email", hint: "Email receipts and feedback links (SMTP)" },
  { key: "pushEnabled", label: "Web Push", hint: "Deliver notifications to service workers across all four apps (needs VAPID keys)" },
];

export function SettingsPage({ onBack }: { onBack?: () => void }) {
  useDocumentTitle(
    "Server settings — Gabfix Admin Console",
    "Branding and notification channel flags for the whole suite.",
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setSettings(await apiClient.get<Settings>("/settings"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<Settings>) {
    setSaving(true);
    setNote("");
    try {
      const snake: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        snake[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
      }
      const fresh = await apiClient.request<Settings>("/settings", {
        method: "PATCH",
        body: JSON.stringify(snake),
      });
      setSettings(fresh);
      setNote("Saved");
      setTimeout(() => setNote(""), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-17 items-center justify-between border-b border-border bg-background/92 px-4 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
              <X />
            </Button>
          )}
          <div>
            <h1 className="text-lg font-semibold">Server settings</h1>
            <p className="text-xs text-muted-foreground">Branding · notification channels</p>
          </div>
        </div>
        {note && <span className="text-xs font-medium text-primary">{note}</span>}
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>
        )}
        {!settings && !error && (
          <div className="flex min-h-[30vh] items-center justify-center">
            <LoaderCircle className="size-7 animate-spin text-muted-foreground" />
          </div>
        )}
        {settings && (
          <>
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-base font-semibold">Branding</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Company name</span>
                  <Input
                    defaultValue={settings.companyName}
                    onBlur={(e) =>
                      e.target.value !== settings.companyName &&
                      save({ companyName: e.target.value })
                    }
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Phone</span>
                  <Input
                    defaultValue={settings.companyPhone}
                    onBlur={(e) =>
                      e.target.value !== settings.companyPhone &&
                      save({ companyPhone: e.target.value })
                    }
                  />
                </label>
                <label className="block space-y-2 sm:col-span-2">
                  <span className="text-sm font-medium">Address</span>
                  <Input
                    defaultValue={settings.companyAddress}
                    onBlur={(e) =>
                      e.target.value !== settings.companyAddress &&
                      save({ companyAddress: e.target.value })
                    }
                  />
                </label>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-1 text-base font-semibold">Notification channels</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Flags gate dispatch only — credentials live in server env.
              </p>
              <ul className="space-y-4">
                {FLAGS.map(({ key, label, hint }) => (
                  <li key={key} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{hint}</p>
                    </div>
                    <Switch
                      checked={Boolean(settings[key])}
                      disabled={saving}
                      onCheckedChange={(checked) => save({ [key]: checked } as Partial<Settings>)}
                    />
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-base font-semibold">Automation</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Appreciation delay (hours)</span>
                  <Input
                    type="number"
                    min={0}
                    max={168}
                    defaultValue={settings.appreciationDelayHours}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== settings.appreciationDelayHours) {
                        save({ appreciationDelayHours: v });
                      }
                    }}
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Feedback retention (days)</span>
                  <Input
                    type="number"
                    min={7}
                    max={3650}
                    defaultValue={settings.feedbackRetentionDays}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== settings.feedbackRetentionDays) {
                        save({ feedbackRetentionDays: v });
                      }
                    }}
                  />
                </label>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-base font-semibold">Web Push</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Delivers notifications to service workers across all four apps.
                Generate VAPID keys once from the server console (logged on
                startup) and paste the public key here.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Push enabled</span>
                  <Switch
                    checked={Boolean(settings.pushEnabled)}
                    disabled={saving}
                    onCheckedChange={(checked) => save({ pushEnabled: checked } as Partial<Settings>)}
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">VAPID public key</span>
                  <Input
                    defaultValue={settings.vapidPublicKey}
                    onBlur={(e) =>
                      e.target.value !== settings.vapidPublicKey &&
                      save({ vapidPublicKey: e.target.value })
                    }
                    placeholder="URL-safe base64 (from server console)"
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave empty to use the server-managed key (if configured).
                  </span>
                </label>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
