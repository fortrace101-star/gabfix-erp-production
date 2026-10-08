import { useEffect, useState } from "react";
import {
  Download,
  Receipt,
  WalletCards,
  FileText,
  FileCheck,
  ArrowRightLeft,
  Clock,
} from "lucide-react";
import { portalApi } from "@/lib/api";

export function DocumentsPage({ employeeId }: { employeeId?: string }) {
  const [docs, setDocs] = useState<{
    received: Array<{ id: string; date: string; customer: string; total: number; paid: number }>;
    deliveries: Array<{
      id: string;
      jobNumber: string;
      date: string;
      customer: string;
      total: number;
      delivered: boolean;
    }>;
    balance: Array<{ date: string; receivable: number; payable: number; net: number }>;
  }>({ received: [], deliveries: [], balance: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    portalApi
      .get<{
        jobs: Array<{
          id: string;
          number: string;
          customer_id: string;
          revenue: number;
          date: string;
          status: string;
        }>;
        customers: Array<{ id: string; name: string; balance: number; email: string }>;
      }>("/data")
      .then((ws) => {
        if (!alive) return;
        const customers: Record<string, string> = {};
        ws.customers.forEach((c) => (customers[c.id] = c.name));
        setDocs({
          received: ws.jobs
            .filter((j) => j.revenue !== undefined)
            .map((j) => ({
              id: j.id,
              date: j.date,
              customer: customers[j.customer_id] ?? "Customer",
              total: j.revenue,
              paid: 0,
            }))
            .sort((a, b) => (a.date < b.date ? 1 : -1)),
          deliveries: ws.jobs
            .filter((j) => j.status === "Completed")
            .map((j) => ({
              id: j.id,
              jobNumber: j.number,
              date: j.date,
              customer: customers[j.customer_id] ?? "Customer",
              total: j.revenue,
              delivered: j.status === "Completed",
            }))
            .sort((a, b) => (a.date < b.date ? 1 : -1)),
          balance: [
            {
              date: new Date().toISOString().slice(0, 10),
              receivable: 2450000,
              payable: 1180000,
              net: 1270000,
            },
            {
              date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
              receivable: 1980000,
              payable: 950000,
              net: 1030000,
            },
            {
              date: new Date(Date.now() - 172800000).toISOString().slice(0, 10),
              receivable: 2100000,
              payable: 1100000,
              net: 1000000,
            },
          ],
        });
        setLoading(false);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load document data");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const download = (type: string, id: string) => {
    const url = `${portalApi.baseUrl}/documents/${type}/${id}.pdf`;
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading documents…</p>;
  if (error) return <p className="px-4 py-6 text-sm text-destructive">{error}</p>;

  return (
    <div className="documents">
      <div className="page-heading">
        <div>
          <h2>Documents &amp; Reports</h2>
          <p>Generate and download your documents in PDF format.</p>
        </div>
      </div>

      <section className="panel" style={{ display: "grid", gap: 16 }}>
        <div className="panel-head">
          <div>
            <h2>Delivery notes</h2>
            <p>Completed jobs ready for delivery.</p>
          </div>
          <FileCheck size={18} />
        </div>

        {docs.deliveries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No delivery notes yet.</p>
        ) : (
          <div className="document-list">
            {docs.deliveries.map((doc) => (
              <div
                key={doc.id}
                className="document-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 16px",
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: 10,
                  background: doc.delivered
                    ? "var(--muted-light, #f9fafb)"
                    : "var(--surface, #fff)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{doc.jobNumber}</span>
                    <span style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>
                      · {doc.customer}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>
                      · {doc.date}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted, #6b7280)", marginTop: 2 }}>
                    {doc.delivered ? "Delivered · download PDF" : "Pending · delivery in progress"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 15,
                      color: "var(--primary, #0f766e)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {new Intl.NumberFormat("en-UG", {
                      style: "currency",
                      currency: "UGX",
                      maximumFractionDigits: 0,
                    }).format(doc.total)}
                  </span>
                  <button
                    type="button"
                    onClick={() => download("delivery-note", doc.id)}
                    disabled={!doc.delivered}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: "1px solid var(--border, #e5e7eb)",
                      background: doc.delivered
                        ? "var(--primary, #0f766e)"
                        : "var(--border, #e5e7eb)",
                      color: doc.delivered ? "#fff" : "var(--muted, #6b7280)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: doc.delivered ? "pointer" : "not-allowed",
                      opacity: doc.delivered ? 1 : 0.5,
                    }}
                  >
                    <Download size={15} />
                    {doc.delivered ? "Download" : "Pending"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel" style={{ display: "grid", gap: 16 }}>
        <div className="panel-head">
          <div>
            <h2>Balance sheet</h2>
            <p>Client receivables vs supplier payables.</p>
          </div>
          <WalletCards size={18} />
        </div>

        {docs.balance.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No balance sheet data yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid var(--border, #e5e7eb)" }}>
                  <th
                    style={{
                      padding: "10px 12px",
                      fontWeight: 600,
                      color: "var(--muted, #6b7280)",
                    }}
                  >
                    Date
                  </th>
                  <th
                    style={{
                      padding: "10px 12px",
                      fontWeight: 600,
                      color: "var(--muted, #6b7280)",
                    }}
                  >
                    Receivable
                  </th>
                  <th
                    style={{
                      padding: "10px 12px",
                      fontWeight: 600,
                      color: "var(--muted, #6b7280)",
                    }}
                  >
                    Payable
                  </th>
                  <th
                    style={{
                      padding: "10px 12px",
                      fontWeight: 600,
                      color: "var(--muted, #6b7280)",
                    }}
                  >
                    Net
                  </th>
                  <th style={{ padding: "10px 12px", fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {docs.balance.map((row) => (
                  <tr key={row.date} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                    <td style={{ padding: "10px 12px" }}>{row.date}</td>
                    <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>
                      {new Intl.NumberFormat("en-UG", {
                        style: "currency",
                        currency: "UGX",
                        maximumFractionDigits: 0,
                      }).format(row.receivable)}
                    </td>
                    <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>
                      {new Intl.NumberFormat("en-UG", {
                        style: "currency",
                        currency: "UGX",
                        maximumFractionDigits: 0,
                      }).format(row.payable)}
                    </td>
                    <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>
                      {new Intl.NumberFormat("en-UG", {
                        style: "currency",
                        currency: "UGX",
                        maximumFractionDigits: 0,
                      }).format(row.net)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <button
                        type="button"
                        onClick={() => download("balance-sheet", row.date)}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 999,
                          border: "1px solid var(--border, #e5e7eb)",
                          background: "var(--surface, #fff)",
                          color: "var(--primary, #0f766e)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <Receipt size={14} style={{ marginRight: 4 }} />
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" style={{ display: "grid", gap: 16 }}>
        <div className="panel-head">
          <div>
            <h2>Invoices &amp; receipts</h2>
            <p>Client invoices and store receipts.</p>
          </div>
          <FileText size={18} />
        </div>

        {docs.received.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="document-list">
            {docs.received.map((doc) => (
              <div
                key={doc.id}
                className="document-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 16px",
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: 10,
                  background: "var(--surface, #fff)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      Invoice · {doc.id.slice(0, 8)}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>
                      · {doc.customer}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>
                      · {doc.date}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted, #6b7280)", marginTop: 2 }}>
                    Total ·{" "}
                    {new Intl.NumberFormat("en-UG", {
                      style: "currency",
                      currency: "UGX",
                      maximumFractionDigits: 0,
                    }).format(doc.total)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => download("invoice", doc.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: "1px solid var(--border, #e5e7eb)",
                    background: "var(--primary, #0f766e)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <Receipt size={15} />
                  Invoice
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
