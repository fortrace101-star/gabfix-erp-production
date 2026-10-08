// Live API round-trip verification: login (John) -> /api/data -> /my-filings
const api = "http://localhost:5000";

async function main() {
  const health = await fetch(`${api}/api/health`).then(r => r.json()).catch(() => null);
  console.log("health:", health ? JSON.stringify(health) : "UNREACHABLE");
  if (!health) process.exit(1);

  const login = await fetch(`${api}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Id": "portal" },
    body: JSON.stringify({ identifier: "john@gabfix.ug", password: "gabfix-staff" }),
  }).then(r => r.json());
  const tok = login.accessToken;
  console.log("TOKEN:", tok ? tok.slice(0, 20) + "..." : "(none)");
  console.log("USER:", login.user?.name, "role=" + login.user?.role, "scope=" + (login.user?.app_scope || []).join(","));

  const h = { Authorization: `Bearer ${tok}` };
  const data = await fetch(`${api}/api/data`, { headers: h }).then(r => r.json());
  console.log("=== GF jobs (GET /api/data) ===");
  for (const j of (data.jobs || []).filter(x => x.id && String(x.id).startsWith("GF-"))) {
    console.log(`  ${j.number} | ${j.status} | rev ${j.revenue} | cost ${j.cost} | assignees=${(j.assignees || []).join(",")}`);
  }

  const f = await fetch(`${api}/api/employees/my-filings`, { headers: h }).then(r => r.json());
  console.log("=== John /my-filings (GET /api/employees/my-filings) ===");
  console.log("timesheets:", (f.timesheets || []).length);
  for (const t of (f.timesheets || [])) console.log(`  ${t.jobNumber} approved=${t.approved} min=${t.minutes}`);
  console.log("costs:", (f.costs || []).length);
  for (const c of (f.costs || [])) console.log(`  ${c.description} = ${c.amount}`);
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
