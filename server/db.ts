import 'dotenv/config';
import { Pool } from 'pg';
import { databaseUrl } from './db-config';

// All credential pieces (host, port, user, password, database) come from the
// single link exported by db-config.ts — see the `localhost` → `127.0.0.1`
// normalisation note there (Windows dual-stack resolver stall).
export const pool = new Pool({
  connectionString: databaseUrl,
  // Ensure unqualified table names always resolve to the public schema.
  options: '-c search_path=public',
  // Self-heal the pool: when PostgreSQL briefly drops/restarts, dead
  // (half-open) client sockets used to strand pool.query() forever because
  // pg defaults to no connection/idle timeout. Recycle idle sockets and cap
  // connect attempts so a blip recovers instead of hanging the API.
  max: 10,
    idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Reject a client that's been waiting too long instead of hanging forever.
  allowExitOnIdle: true,
});

// Best practice (pg docs): when PostgreSQL closes an idle client socket
// mid-session, the client surfaces an 'error' event. Releasing it with
// `true` (discard) makes the pool drop the half-open socket and hand out a
// fresh connection on the next query. This is the missing piece that strands
// queries and triggers the 500/hang symptom once idleTimeoutMillis recycles
// idle sockets — without it, a dead socket can be checked out and used.
pool.on('error', (err: unknown, client) => {
  console.error('[db] evicting dead idle client:', err instanceof Error ? err.message : String(err));
  client.release(true);
});

export type AppData = {
  customers: unknown[];
  services: unknown[];
  jobs: unknown[];
  invoices: unknown[];
  expenses: unknown[];
  laundry: unknown[];
  equipment: unknown[];
  inventory: unknown[];
  payments: unknown[];
  costCategories: unknown[];
  suppliers: unknown[];
  depreciationEntries: unknown[];
  laundryItems: unknown[];
  inventoryMovements: unknown[];
  purchaseRequests: unknown[];
  toolCheckouts: unknown[];
  utilityCaptures: unknown[];
  /** Role-dashboard slices (021): acquisition pipeline, reminder queue, log. */
  leads: unknown[];
  followUps: unknown[];
  interactions: unknown[];
  feedback: unknown[];
  /** Minimal people feed for the supervisor's team-performance view. */
    people: unknown[];
  /** Field-ops reads (Phase 1b/1c): crew assignments + lifecycle log for the
   *  Technician "My jobs" strip, plus own cost/timesheet filings for the
   *  Technician/Accountant boards. */
  jobAssignments: unknown[];
  jobEvents: unknown[];
  timesheets: unknown[];
  jobCosts: unknown[];
};

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

/** Load the whole workspace from PostgreSQL, shaped exactly like the frontend AppData type. */
export async function getData(): Promise<AppData> {
  const [customers, services, jobs, invoices, expenses, laundry, equipment, inventory, payments, costCategories, suppliers, depreciationEntries, laundryItems, inventoryMovements, purchaseRequests, toolCheckouts, utilityCaptures, leads, followUps, interactions, feedback, people, jobAssignments, jobEvents, timesheets, jobCosts] = await Promise.all([
    pool.query(`SELECT id, name, company, type, phone, email, balance::float8 AS balance, status,
                       salesperson_id AS "salespersonId", source_lead_id AS "sourceLeadId",
                       last_contacted_at AS "lastContactedAt"
                FROM customers ORDER BY id`),
    pool.query(`SELECT id, name, division, method, price::float8 AS price, active FROM services ORDER BY id`),
    pool.query(`SELECT id, number, customer_id AS "customerId", service_id AS "serviceId",
                       date::text AS date, scheduled_date::text AS "scheduledDate",
                       quote_date::text AS "quoteDate", promised_at::text AS "promisedAt",
                       status, priority, revenue::float8 AS revenue, cost::float8 AS cost,
                       assignees, equipment_usage AS "equipmentUsage",
                       salesperson_id AS "salespersonId", manager_id AS "managerId",
                       site_address AS "siteAddress", lat::float8 AS lat, lng::float8 AS lng,
                       source, proposed_by AS "proposedBy",
                       confirmed_at::text AS "confirmedAt", confirmed_by AS "confirmedBy",
                       cancel_reason AS "cancelReason", share_token::text AS "shareToken",
                       share_sent_at::text AS "shareSentAt", closed_at::text AS "closedAt"
                FROM jobs ORDER BY date DESC, id DESC`),
    pool.query(`SELECT id, number, customer_id AS "customerId", date::text AS date, due::text AS due,
                       total::float8 AS total, paid::float8 AS paid, status
                FROM invoices ORDER BY date DESC, id DESC`),
    pool.query(`SELECT id, category, description, amount::float8 AS amount,
                       date::text AS date, division
                FROM expenses ORDER BY date DESC, id DESC`),
    pool.query(`SELECT id, number, customer_id AS "customerId", status, total::float8 AS total, paid::float8 AS paid,
                       items, received::text AS received,
                       promised_at::text AS "promisedAt", ready_at::text AS "readyAt",
                       collected_at::text AS "collectedAt", job_id AS "jobId",
                       weight_kg::float8 AS "weightKg", pieces
                FROM laundry_orders ORDER BY received DESC, id DESC`),
    pool.query(`SELECT id, name, serial_number AS "serialNumber", type, value::float8 AS value,
                       book_value::float8 AS "bookValue", condition, next_maintenance::text AS "nextMaintenance",
                       usage::float8 AS usage, purchase_date::text AS "purchaseDate",
                       cost::float8 AS cost, salvage_value::float8 AS "salvageValue",
                       useful_life_months AS "usefulLifeMonths", depreciation_method AS "depreciationMethod",
                       accumulated_depreciation::float8 AS "accumulatedDepreciation",
                       disposed_at::text AS "disposedAt",
                       custodian_employee_id AS "custodianEmployeeId"
                FROM equipment ORDER BY id`),
    pool.query(`SELECT id, name, category, unit, quantity::float8 AS quantity, minimum::float8 AS minimum,
                       cost::float8 AS cost, code, location, kind,
                       supplier_id AS "supplierId"
                FROM inventory_items ORDER BY id`),
    pool.query(`SELECT id, number, direction, customer_id AS "customerId", method_id AS "methodId",
                       amount::float8 AS amount, currency, reference, invoice_id AS "invoiceId",
                       laundry_order_id AS "laundryOrderId", job_id AS "jobId", status,
                       received_at::text AS "receivedAt"
                FROM payments WHERE deleted_at IS NULL ORDER BY received_at DESC, id DESC`),
    pool.query(`SELECT id, name, gl_account_code AS "glAccountCode", kind FROM cost_categories
                WHERE deleted_at IS NULL ORDER BY name`),
    pool.query(`SELECT id, name, phone, email, notes,
                       contact, categories, spend_ytd::float8 AS "spendYtd", rating
                FROM suppliers WHERE deleted_at IS NULL ORDER BY name`),
    pool.query(`SELECT id, equipment_id AS "equipmentId", period, amount::float8 AS amount,
                       accumulated::float8 AS accumulated, book_value::float8 AS "bookValue",
                       created_at::text AS "createdAt"
                FROM asset_depreciation_entries ORDER BY equipment_id, period`),
    pool.query(`SELECT id, order_id AS "orderId", service_id AS "serviceId", description,
                       qty::float8 AS qty, unit, unit_price::float8 AS "unitPrice",
                       amount::float8 AS amount
                FROM laundry_order_items ORDER BY order_id, id`),
    pool.query(`SELECT id, item_id AS "itemId", type, qty::float8 AS qty, reference,
                       moved_on::text AS "movedOn", by_name AS "byName"
                FROM inventory_movements ORDER BY moved_on DESC, id DESC`),
    pool.query(`SELECT id, item_id AS "itemId", description, qty::float8 AS qty,
                       supplier_id AS "supplierId", value::float8 AS value,
                       requested_by AS "requestedBy", requested_on::text AS "requestedOn",
                       status, decided_by AS "decidedBy", decided_on::text AS "decidedOn"
                FROM purchase_requests ORDER BY requested_on DESC, id DESC`),
    pool.query(`SELECT id, code, name, condition, status,
                       holder_employee_id AS "holderEmployeeId", holder_name AS "holderName",
                       job_id AS "jobId", job_label AS "jobLabel", due_back::text AS "dueBack", notes,
                       equipment_id AS "equipmentId"
                FROM tool_checkouts ORDER BY id`),
    pool.query(`SELECT id, captured_on::text AS "capturedOn", type, reference, reading,
                       amount::float8 AS amount, category_kind AS "categoryKind",
                       captured_by AS "capturedBy", status, expense_id AS "expenseId"
                FROM utility_captures ORDER BY captured_on DESC, id DESC`),
    pool.query(`SELECT id, name, contact, company, phone, email,
                       salesperson_id AS "salespersonId", stage,
                       value::float8 AS value, source,
                       next_follow_up_at AS "nextFollowUpAt",
                       converted_customer_id AS "convertedCustomerId",
                       notes, created_at::text AS "createdAt"
                FROM leads WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`),
    pool.query(`SELECT id, type, owner_employee_id AS "ownerEmployeeId", owner_role AS "ownerRole",
                       customer_id AS "customerId", lead_id AS "leadId", job_id AS "jobId",
                       notes, due_at AS "dueAt", status,
                       follow_up_after_days AS "followUpAfterDays",
                       completed_at AS "completedAt", created_at::text AS "createdAt"
                FROM follow_ups ORDER BY due_at ASC`),
    pool.query(`SELECT id, customer_id AS "customerId", lead_id AS "leadId", job_id AS "jobId",
                       employee_id AS "employeeId", channel, notes, outcome,
                       next_follow_up_at AS "nextFollowUpAt", created_at::text AS "createdAt"
                FROM interactions ORDER BY created_at DESC LIMIT 250`),
    pool.query(`SELECT id, job_id AS "jobId", customer_id AS "customerId", rating, comment,
                       submitted_at AS "submittedAt"
                FROM feedback ORDER BY submitted_at DESC LIMIT 250`),
    pool.query(`SELECT id, name, role FROM employees
                WHERE deleted_at IS NULL AND active = TRUE
                ORDER BY role, name`),
    pool.query(`SELECT a.job_id AS "jobId", a.employee_id AS "employeeId", e.name AS "employeeName",
                       a.role, a.assigned_at::text AS "assignedAt", a.accepted_at::text AS "acceptedAt",
                       a.completed_at::text AS "completedAt", j.number AS "jobNumber",
                       j.customer_id AS "customerId", j.status, j.scheduled_date::text AS "scheduledDate",
                       j.revenue::float8 AS revenue
                FROM job_assignments a
                JOIN employees e ON e.id = a.employee_id
                JOIN jobs j ON j.id = a.job_id
                ORDER BY a.assigned_at DESC, j.number`),
    pool.query(`SELECT job_id AS "jobId", kind, at::text AS "at",
                       actor_employee_id AS "actorEmployeeId", payload
                FROM job_events
                ORDER BY at DESC`),
    pool.query(`SELECT t.id, t.employee_id AS "employeeId", t.job_id AS "jobId",
                       j.number AS "jobNumber", t.started_at::text AS "startedAt",
                       t.ended_at::text AS "endedAt", t.minutes, t.rate::float8 AS rate,
                       (t.approved_by IS NOT NULL) AS approved
                FROM timesheets t
                LEFT JOIN jobs j ON j.id = t.job_id
                ORDER BY t.started_at DESC`),
    pool.query(`SELECT c.id, c.job_id AS "jobId", j.number AS "jobNumber",
                       cc.name AS "categoryName", c.category_id AS "categoryId",
                       c.description, c.qty::float8 AS qty, c.unit_cost::float8 AS "unitCost",
                       c.amount::float8 AS amount, c.source, c.created_at::text AS "createdAt"
                FROM job_costs c
                LEFT JOIN jobs j ON j.id = c.job_id
                LEFT JOIN cost_categories cc ON cc.id = c.category_id
                ORDER BY c.created_at DESC, c.id DESC`),
  ]);

  return {
    customers: customers.rows,
    services: services.rows,
    jobs: jobs.rows.map((row) => ({ ...row, equipmentUsage: row.equipmentUsage ?? [] })),
    invoices: invoices.rows,
    expenses: expenses.rows,
    laundry: laundry.rows,
    equipment: equipment.rows.map((row) => ({ ...row, value: num(row.value), bookValue: num(row.bookValue), usage: num(row.usage) })),
    inventory: inventory.rows,
    payments: payments.rows,
    costCategories: costCategories.rows,
    suppliers: suppliers.rows,
    depreciationEntries: depreciationEntries.rows,
    laundryItems: laundryItems.rows,
    inventoryMovements: inventoryMovements.rows,
    purchaseRequests: purchaseRequests.rows,
    toolCheckouts: toolCheckouts.rows,
    utilityCaptures: utilityCaptures.rows,
    leads: leads.rows,
    followUps: followUps.rows,
    interactions: interactions.rows,
    feedback: feedback.rows,
        people: people.rows,
    jobAssignments: jobAssignments.rows,
    jobEvents: jobEvents.rows,
    timesheets: timesheets.rows,
    jobCosts: jobCosts.rows,
  };
}
