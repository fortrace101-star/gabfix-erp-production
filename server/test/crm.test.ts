import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { pool, getData } from '../db';
import { migrate } from '../migrate';
import { crmRouter } from '../routes/crm';
import { can } from '../routes/permission-matrix';

/**
 * Role-dashboard spine (migration 021): leads, the shared follow-up queue and
 * the interaction log behind the Sales / CSR / Supervisor panes.
 *
 * The router's handlers own the SQL (pipeline attribution, the `last_contacted_at`
 * stamp, the CSR re-queue cadence), so these tests drive them directly — the same
 * layer-extraction trick events.test.ts uses, minus the SSE plumbing.
 */

type Actor = { id: string; name: string; role: string; app_scope: string[] };

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }>;
  };
};

/** All layers on the route, so the capability gate runs before the handler. */
function handlersFor(method: string, path: string) {
  const layers = (crmRouter as unknown as { stack: RouteLayer[] }).stack;
  const match = layers.find((layer) => layer.route?.methods[method] && layer.route.path === path);
  if (!match?.route) throw new Error(`No ${method.toUpperCase()} ${path} handler on the CRM router`);
  return match.route.stack.map((layer) => layer.handle);
}

type Reply = { status: number; body: Record<string, unknown> };

/** Minimal response double: resolves as soon as the handler answers. */
function invoke(
  method: string,
  path: string,
  options: { body?: unknown; params?: Record<string, string>; user?: Actor } = {},
): Promise<Reply> {
  return new Promise((resolve) => {
    const req = {
      body: options.body ?? {},
      params: options.params ?? {},
      user: options.user,
      headers: {},
    } as unknown as Request;
    const res = {
      statusCode: 200,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: Record<string, unknown>) {
        resolve({ status: res.statusCode, body: payload });
        return res;
      },
    } as unknown as Response;
    const chain = handlersFor(method, path);
    let index = 0;
    const next = () => {
      const layer = chain[index++];
      // Running off the end means nothing answered — surface it instead of hanging.
      if (!layer) return resolve({ status: 0, body: { error: `${method.toUpperCase()} ${path} never replied` } });
      layer(req, res, next);
    };
    next();
  });
}

const salesActor: Actor = { id: 'test-sales', name: 'Test Sales', role: 'sales', app_scope: ['portal'] };

// ── Pure tests (no database) ──────────────────────────────────────────────────

test('handle_leads is held by owner, manager, csr and sales only', () => {
  for (const role of ['owner', 'manager', 'csr', 'sales']) {
    assert.equal(can(role, 'handle_leads'), true, `${role} should handle leads`);
  }
  for (const role of ['technician', 'laundry', 'storekeeper', 'accountant']) {
    assert.equal(can(role, 'handle_leads'), false, `${role} should not handle leads`);
  }
  assert.equal(can('owner', 'not_a_capability'), false, 'unknown capabilities are never granted');
});

test('an unqualified role is refused with 403 before any write', async () => {
  const reply = await invoke('post', '/leads', {
    body: { name: 'Should not land' },
    user: { id: 'test-tech', name: 'Test Tech', role: 'technician', app_scope: ['portal'] },
  });
  assert.equal(reply.status, 403);
});

test('a malformed lead is rejected with 422 and per-field details', async () => {
  const reply = await invoke('post', '/leads', { body: { company: 'No name' }, user: salesActor });
  assert.equal(reply.status, 422);
  assert.ok(reply.body.fields, 'the 422 should name the offending fields');
});

test('unknown fields are refused rather than silently dropped', async () => {
  const reply = await invoke('post', '/leads', {
    body: { name: 'Unknown field lead', stage: 'Lead', sneaky: true },
    user: salesActor,
  });
  assert.equal(reply.status, 422);
});

// ── Integration tests (real PostgreSQL; skipped when unreachable) ────────────

const dbUp = await pool
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false);

if (dbUp) {
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }

  test('lead → stage advance → interaction → follow-up cadence round-trips', { timeout: 30_000 }, async () => {
    const run = Date.now().toString(36);
    const customerId = `crm-test-c-${run}`;
    const serviceId = `crm-test-s-${run}`;
    const jobId = `crm-test-j-${run}`;
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    let leadId = '';
    let salesId = '';
    let csrId = '';

    try {
      // Temp actors + records: sales owns the pipeline, csr owns the outreach.
      const staff = await pool.query(
        `INSERT INTO employees (name, role, app_scope, active) VALUES
           ($1, 'sales', ARRAY['portal']::TEXT[], TRUE),
           ($2, 'csr',   ARRAY['portal']::TEXT[], TRUE)
         RETURNING id, role`,
        [`CRM Test Sales ${run}`, `CRM Test CSR ${run}`],
      );
      salesId = staff.rows.find((row) => row.role === 'sales').id;
      csrId = staff.rows.find((row) => row.role === 'csr').id;

      await pool.query(
        `INSERT INTO customers (id, name, status, salesperson_id) VALUES ($1, 'CRM Test Ltd', 'Active', $2)`,
        [customerId, salesId],
      );
      await pool.query(`INSERT INTO services (id, name) VALUES ($1, 'CRM Test Service')`, [serviceId]);
      await pool.query(
        `INSERT INTO jobs (id, number, customer_id, service_id, date, status, completed_at, salesperson_id)
         VALUES ($1, $2, $3, $4, '2026-09-27', 'Completed', now(), $5)`,
        [jobId, `JOB-CRM-${run}`, customerId, serviceId, salesId],
      );

      const sales: Actor = { id: salesId, name: `CRM Test Sales ${run}`, role: 'sales', app_scope: ['portal'] };
      const csr: Actor = { id: csrId, name: `CRM Test CSR ${run}`, role: 'csr', app_scope: ['portal'] };

      // 1. Enter a lead exactly as the Sales pane does: only the fields the
      //    "new client" modal collected (no email, no notes).
      const created = await invoke('post', '/leads', {
        body: {
          name: 'CRM Test Lead',
          contact: 'Amina',
          company: 'CRM Test Ltd',
          phone: '+256700000000',
          stage: 'Lead',
          value: 250000,
          source: 'portal',
          nextFollowUpAt: dueAt,
        },
        user: sales,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      leadId = String(created.body.id);

      const leadRow = await pool.query(
        `SELECT stage, value::float8 AS value, salesperson_id, created_by, email, notes
         FROM leads WHERE id = $1`,
        [leadId],
      );
      assert.equal(leadRow.rows[0].salesperson_id, salesId, 'the lead belongs to the sales person who entered it');
      assert.equal(leadRow.rows[0].created_by, salesId);
      assert.equal(leadRow.rows[0].stage, 'Lead');
      assert.equal(leadRow.rows[0].value, 250000);
      assert.equal(leadRow.rows[0].email, '', 'omitted text columns fall back to the empty-string default');
      assert.equal(leadRow.rows[0].notes, '');

      // 2. Advance the workflow — the Sales pane's stage button sends stage alone.
      const patched = await invoke('patch', '/leads/:id', {
        params: { id: leadId },
        body: { stage: 'Negotiation' },
        user: sales,
      });
      assert.equal(patched.status, 200, JSON.stringify(patched.body));

      // ...and a one-field repricing patch is just as valid.
      const repriced = await invoke('patch', '/leads/:id', {
        params: { id: leadId },
        body: { value: 275000 },
        user: sales,
      });
      assert.equal(repriced.status, 200, JSON.stringify(repriced.body));

      const advanced = await pool.query(`SELECT stage, value::float8 AS value FROM leads WHERE id = $1`, [leadId]);
      assert.equal(advanced.rows[0].stage, 'Negotiation');
      assert.equal(advanced.rows[0].value, 275000);

      const missing = await invoke('patch', '/leads/:id', {
        params: { id: 'ld-does-not-exist' },
        body: { stage: 'Won' },
        user: sales,
      });
      assert.equal(missing.status, 404);

      // 3. Log the contact: stamps last_contacted_at and chains the next touch.
      const logged = await invoke('post', '/interactions', {
        body: {
          customerId,
          channel: 'call',
          notes: 'Discussed the revised quote',
          outcome: 'Wants it Friday',
          nextFollowUpAt: dueAt,
        },
        user: sales,
      });
      assert.equal(logged.status, 201, JSON.stringify(logged.body));
      const stamped = await pool.query(`SELECT last_contacted_at FROM customers WHERE id = $1`, [customerId]);
      assert.ok(stamped.rows[0].last_contacted_at, 'the customer contact stamp should be set');
      const chained = await pool.query(
        `SELECT owner_employee_id, due_at::text AS due_at
         FROM follow_ups WHERE customer_id = $1 AND type = 'client_follow_up'`,
        [customerId],
      );
      assert.equal(chained.rows.length, 1, 'a next touch queues exactly one reminder');
      assert.equal(chained.rows[0].owner_employee_id, salesId);
      assert.equal(new Date(chained.rows[0].due_at).toISOString(), dueAt);

      // 4. CSR cadence: outreach completed with no feedback comes straight back.
      const outreach = await invoke('post', '/follow-ups', {
        body: { type: 'feedback_outreach', jobId, customerId, dueAt, notes: 'Ask how the job went' },
        user: csr,
      });
      assert.equal(outreach.status, 201, JSON.stringify(outreach.body));
      const outreachId = String(outreach.body.id);
      const outreachRow = await pool.query(`SELECT owner_role FROM follow_ups WHERE id = $1`, [outreachId]);
      assert.equal(outreachRow.rows[0].owner_role, 'csr', 'a CSR-scheduled reminder stays on the CSR queue');

      const done = await invoke('patch', '/follow-ups/:id', {
        params: { id: outreachId },
        body: { status: 'done', requeueDays: 5 },
        user: csr,
      });
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.equal(done.body.status, 'done');
      const requeuedId = done.body.requeued as string | null;
      assert.equal(typeof requeuedId, 'string', 'outreach without feedback should re-queue');

      const requeued = await pool.query(
        `SELECT type, job_id, status, due_at, follow_up_after_days
         FROM follow_ups WHERE id = $1`,
        [requeuedId],
      );
      assert.equal(requeued.rows[0].type, 'feedback_outreach');
      assert.equal(requeued.rows[0].status, 'pending');
      assert.equal(requeued.rows[0].job_id, jobId);
      assert.equal(requeued.rows[0].follow_up_after_days, 5);
      const deltaDays = (Date.parse(requeued.rows[0].due_at) - Date.now()) / 86_400_000;
      assert.ok(deltaDays > 4.9 && deltaDays < 5.1, `re-queue should land ~5 days out (got ${deltaDays.toFixed(2)})`);

      // 5. Once feedback lands the cadence stops.
      await pool.query(
        `INSERT INTO feedback (job_id, customer_id, rating, comment) VALUES ($1, $2, 5, 'All good')`,
        [jobId, customerId],
      );
      const settled = await invoke('patch', '/follow-ups/:id', {
        params: { id: String(requeuedId) },
        body: { status: 'done' },
        user: csr,
      });
      assert.equal(settled.status, 200, JSON.stringify(settled.body));
      assert.equal(settled.body.requeued, null, 'recorded feedback closes the outreach loop');

      // 6. The panes read these slices off GET /api/data.
      const data = await getData();
      const lead = data.leads.find((row) => (row as { id: string }).id === leadId) as
        | { salespersonId: string | null }
        | undefined;
      assert.ok(lead, 'the new lead should surface in the workspace read');
      assert.equal(lead.salespersonId, salesId, 'the read aliases salesperson_id → salespersonId');
      assert.ok(
        (data.followUps as Array<{ id: string }>).some((row) => row.id === String(requeuedId)),
        'follow-ups ride the workspace read',
      );
      assert.ok(
        (data.people as Array<{ id: string }>).some((row) => row.id === csrId),
        'the people feed (supervisor view) includes the temp CSR',
      );
    } finally {
      // Children before parents: every CRM row references customers/jobs/leads.
      await pool.query(`DELETE FROM follow_ups WHERE customer_id = $1 OR job_id = $2`, [customerId, jobId]);
      await pool.query(`DELETE FROM interactions WHERE customer_id = $1 OR lead_id = $2`, [customerId, leadId]);
      await pool.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
      await pool.query(`DELETE FROM feedback WHERE job_id = $1`, [jobId]);
      await pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
      await pool.query(`DELETE FROM services WHERE id = $1`, [serviceId]);
      await pool.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
      if (salesId) await pool.query(`DELETE FROM employees WHERE id = $1`, [salesId]);
      if (csrId) await pool.query(`DELETE FROM employees WHERE id = $1`, [csrId]);
    }
  });
} else {
  test('crm integration skipped (no PostgreSQL reachable)', () => {
    console.warn('[crm.test] PostgreSQL unreachable — integration tests skipped');
  });
}