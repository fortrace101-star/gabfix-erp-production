import { z } from 'zod';
import type { SequenceKey } from '../services/numbering';
import {
  dateText,
  idText,
  money,
  optionalDateText,
  optionalEquipmentUsage,
  optionalMoney,
  optionalText,
  optionalTextList,
  text,
} from './common';

export type { SequenceKey } from '../services/numbering';

/**
 * One resource per stored table (Phase 0.7).
 *
 * `columns` is the explicit field -> column map for that resource: a field that
 * is not listed here can never reach SQL, and because every schema is strict a
 * field that is not in the schema is rejected with 422 instead of being dropped.
 *
 * `create`/`patch` validate request bodies for the routes; `row` validates one
 * record inside a backup payload (POST /api/import) and is deliberately lenient
 * about *missing* fields — column defaults still apply — but never about
 * unknown ones.
 */
export type Resource = {
  table: string;
  /** Collection key inside a backup payload (the AppData shape). */
  dataKey: string;
  /** Human label for fallback error messages, e.g. "customer" -> "Invalid customer". */
  label: string;
  /** Explicit camelCase field -> snake_case column map. */
  columns: Record<string, string>;
  /** Columns the pg driver needs stringified (JSONB). */
  jsonColumns?: ReadonlySet<string>;
  create: z.ZodType;
  patch?: z.ZodType;
  row: z.ZodType;
};

/** Columns stored as JSONB must be stringified before reaching the pg driver. */
export const JSONB_COLUMNS: ReadonlySet<string> = new Set(['equipment_usage']);

/** Job status values used by the client (types.ts) and the seed data.
 *
 * P1 lifecycle (cleaning-operations-workflow.md): a salesperson creates a
 * `Proposed` order; only manager/customer-support may move it to `Confirmed`;
 * `Follow-up` and `Closed` close the loop after feedback. `Inspection` is the
 * priced-quote precursor already used by the checklist engine (025).
 */
export const JOB_STATUSES = [
  'Proposed', 'Confirmed', 'Inspection', 'Quoted', 'Scheduled',
  'In Progress', 'Follow-up', 'Completed', 'Invoiced', 'Paid',
  'Closed', 'Cancelled',
] as const;
const jobStatus = z.enum(JOB_STATUSES);

/** Job priority ladder (009_jobs_dates). Default 'Normal'. */
export const JOB_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const;

/** A PATCH must change something; an empty body is a validation failure. */
const atLeastOneField = <T extends z.ZodType>(schema: T) =>
  schema.refine((value) => Object.keys(value as Record<string, unknown>).length > 0, {
    message: 'Provide at least one field to update',
  });

/** Import rows may omit anything the database can default, and may carry an id. */
const importRow = <T extends z.ZodObject<z.ZodRawShape>>(create: T) =>
  create.partial().extend({ id: idText.optional() });

/**
 * customers — name and phone open an account; everything else is optional.
 */
const customerCreate = z.strictObject({
  name: text,
  phone: text,
  company: optionalText.optional(),
  type: optionalText.optional(),
  email: optionalText.optional(),
  balance: optionalMoney,
  status: optionalText.optional(),
});

export const customersResource: Resource = {
  table: 'customers',
  dataKey: 'customers',
  label: 'customer',
  columns: {
    name: 'name',
    company: 'company',
    type: 'type',
    phone: 'phone',
    email: 'email',
    balance: 'balance',
    status: 'status',
  },
  create: customerCreate,
  // The admin edit modal patches account details; balance moves through the
  // ledger (payments/invoices), never through a direct PATCH.
  patch: atLeastOneField(
    customerCreate
      .omit({ phone: true })
      .extend({
        phone: optionalText.optional(),
        balance: optionalMoney,
      })
      .partial(),
  ),
  row: importRow(customerCreate),
};

/**
 * services — a catalogue entry; price and active flag drive every pricing view.
 */
const serviceCreate = z.strictObject({
  name: text,
  division: optionalText.optional(),
  method: optionalText.optional(),
  price: optionalMoney,
  active: z.boolean().optional(),
});

export const servicesResource: Resource = {
  table: 'services',
  dataKey: 'services',
  label: 'service',
  columns: { name: 'name', division: 'division', method: 'method', price: 'price', active: 'active' },
  create: serviceCreate,
  row: importRow(serviceCreate),
};

/**
 * jobs — the operational core: numbering, dates, money and the equipment log.
 */
const jobCreate = z.strictObject({
  number: text.optional(),
  customerId: idText,
  serviceId: idText,
  date: dateText,
  // Lifecycle dates (009): legacy `date` stays the execution day.
  scheduledDate: optionalDateText,
  quoteDate: optionalDateText,
  promisedAt: optionalDateText,
  status: jobStatus.optional(),
  priority: z.enum(JOB_PRIORITIES).optional(),
  revenue: money,
  cost: optionalMoney,
  assignees: optionalTextList,
  equipmentUsage: optionalEquipmentUsage,
  // Commercial attribution and the work site.
  salespersonId: idText.optional(),
  managerId: idText.optional(),
  siteAddress: optionalText.optional(),
  lat: optionalMoney,
  lng: optionalMoney,
});

export const jobsResource: Resource = {
  table: 'jobs',
  dataKey: 'jobs',
  label: 'job',
  columns: {
    number: 'number',
    customerId: 'customer_id',
    serviceId: 'service_id',
    date: 'date',
    scheduledDate: 'scheduled_date',
    quoteDate: 'quote_date',
    promisedAt: 'promised_at',
    status: 'status',
    priority: 'priority',
    revenue: 'revenue',
    cost: 'cost',
    assignees: 'assignees',
    equipmentUsage: 'equipment_usage',
    salespersonId: 'salesperson_id',
    managerId: 'manager_id',
    siteAddress: 'site_address',
    lat: 'lat',
    lng: 'lng',
  },
  jsonColumns: JSONB_COLUMNS,
  create: jobCreate,
  // The job status modal patches status plus equipment hours; the lifecycle
  // timestamps (started_at, completed_at, ...) are deliberately not writable
  // here — they move when status endpoints land.
  patch: atLeastOneField(
    z.strictObject({
      status: jobStatus.optional(),
      equipmentUsage: optionalEquipmentUsage,
      assignees: optionalTextList,
      revenue: optionalMoney,
      cost: optionalMoney,
      date: optionalDateText,
      scheduledDate: optionalDateText,
      quoteDate: optionalDateText,
      promisedAt: optionalDateText,
      priority: z.enum(JOB_PRIORITIES).optional(),
      salespersonId: idText.optional(),
      managerId: idText.optional(),
      siteAddress: optionalText.optional(),
      lat: optionalMoney,
      lng: optionalMoney,
    }),
  ),
  row: importRow(jobCreate),
};

/**
 * expenses — operating costs; date defaults to today in the route when omitted.
 */
const expenseCreate = z.strictObject({
  category: text,
  description: text,
  amount: money,
  division: optionalText.optional(),
  date: optionalDateText,
});

export const expensesResource: Resource = {
  table: 'expenses',
  dataKey: 'expenses',
  label: 'expense',
  columns: {
    category: 'category',
    description: 'description',
    amount: 'amount',
    date: 'date',
    division: 'division',
  },
  create: expenseCreate,
  row: importRow(expenseCreate),
};

/**
 * equipment — assets, their book value and the next maintenance date.
 */
/** Depreciation schedule fields (Phase 1 asset register). */
const DEPRECIATION_METHODS = ['straight-line', 'none'] as const;

const equipmentCreate = z.strictObject({
  name: text,
  serialNumber: text,
  type: optionalText.optional(),
  value: money,
  bookValue: optionalMoney,
  condition: optionalText.optional(),
  nextMaintenance: optionalDateText,
  usage: optionalMoney,
  purchaseDate: optionalDateText,
  salvageValue: optionalMoney,
  usefulLifeMonths: z
    .preprocess((value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value), z.number().int().positive('Must be a positive whole number of months'))
    .optional(),
  depreciationMethod: z.enum(DEPRECIATION_METHODS).optional(),
  custodianEmployeeId: idText.optional(),
});

export const equipmentResource: Resource = {
  table: 'equipment',
  dataKey: 'equipment',
  label: 'equipment',
  columns: {
    name: 'name',
    serialNumber: 'serial_number',
    type: 'type',
    value: 'value',
    bookValue: 'book_value',
    condition: 'condition',
    nextMaintenance: 'next_maintenance',
    usage: 'usage',
    purchaseDate: 'purchase_date',
    salvageValue: 'salvage_value',
    usefulLifeMonths: 'useful_life_months',
    depreciationMethod: 'depreciation_method',
    custodianEmployeeId: 'custodian_employee_id',
  },
  create: equipmentCreate,
  // Asset update modal plus the usage bump when a job completes.
  // Accumulated depreciation is schedule-owned: postings move it, not PATCHes.
  patch: atLeastOneField(
    z.strictObject({
      name: text.optional(),
      serialNumber: text.optional(),
      type: optionalText.optional(),
      value: optionalMoney,
      bookValue: optionalMoney,
      condition: optionalText.optional(),
      nextMaintenance: optionalDateText,
      usage: optionalMoney,
      purchaseDate: optionalDateText,
      salvageValue: optionalMoney,
      usefulLifeMonths: z
        .preprocess((value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value), z.number().int().positive('Must be a positive whole number of months'))
        .optional(),
      depreciationMethod: z.enum(DEPRECIATION_METHODS).optional(),
      custodianEmployeeId: idText.optional(),
    }),
  ),
  row: importRow(equipmentCreate),
};

/**
 * inventory_items — stock on hand. A stock movement posts `quantity` only; any
 * other field (such as the note the modal collects) is rejected with 422 rather
 * than silently dropped. Storing movement notes arrives with Phase 1.
 */
const inventoryCreate = z.strictObject({
  name: text,
  category: text,
  unit: optionalText.optional(),
  quantity: optionalMoney,
  minimum: optionalMoney,
  cost: optionalMoney,
});

export const inventoryResource: Resource = {
  table: 'inventory_items',
  dataKey: 'inventory',
  label: 'inventory item',
  columns: {
    name: 'name',
    category: 'category',
    unit: 'unit',
    quantity: 'quantity',
    minimum: 'minimum',
    cost: 'cost',
  },
  create: inventoryCreate,
  patch: atLeastOneField(
    z.strictObject({
      name: text.optional(),
      category: text.optional(),
      unit: optionalText.optional(),
      quantity: optionalMoney,
      minimum: optionalMoney,
      cost: optionalMoney,
    }),
  ),
  row: importRow(inventoryCreate),
};

/**
 * invoices and laundry_orders are read-only in this phase: no route writes them
 * yet, so they only need a row schema for backup import.
 */
export const invoicesResource: Resource = {
  table: 'invoices',
  dataKey: 'invoices',
  label: 'invoice',
  columns: {
    number: 'number',
    customerId: 'customer_id',
    date: 'date',
    due: 'due',
    total: 'total',
    paid: 'paid',
    status: 'status',
  },
  create: z.strictObject({}),
  row: z.strictObject({
    id: idText.optional(),
    number: optionalText.optional(),
    customerId: idText.optional(),
    date: optionalDateText,
    due: optionalDateText,
    total: optionalMoney,
    paid: optionalMoney,
    status: optionalText.optional(),
  }),
};

export const laundryResource: Resource = {
  table: 'laundry_orders',
  dataKey: 'laundry',
  label: 'laundry order',
  columns: {
    number: 'number',
    customerId: 'customer_id',
    status: 'status',
    total: 'total',
    paid: 'paid',
    items: 'items',
    received: 'received',
    promisedAt: 'promised_at',
    readyAt: 'ready_at',
    collectedAt: 'collected_at',
    jobId: 'job_id',
    weightKg: 'weight_kg',
    pieces: 'pieces',
  },
  create: z.strictObject({}),
  row: z.strictObject({
    id: idText.optional(),
    number: optionalText.optional(),
    customerId: idText.optional(),
    status: optionalText.optional(),
    total: optionalMoney,
    paid: optionalMoney,
    items: optionalText.optional(),
    received: optionalDateText,
    promisedAt: optionalDateText,
    readyAt: optionalDateText,
    collectedAt: optionalDateText,
    jobId: idText.optional(),
    weightKg: optionalMoney,
    pieces: z
      .preprocess(
        (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
        z.number({ error: 'Must be a number' }).int().nonnegative(),
      )
      .optional(),
  }),
};

/**
 * Every resource, in import order: parents before children so foreign keys hold
 * while a backup is restored.
 */
export const RESOURCES: Resource[] = [
  customersResource,
  servicesResource,
  jobsResource,
  invoicesResource,
  expensesResource,
  laundryResource,
  equipmentResource,
  inventoryResource,
];

/** Look up a resource by table name; throws for a table nobody registered. */
export function resourceByTable(table: string): Resource {
  const resource = RESOURCES.find((candidate) => candidate.table === table);
  if (!resource) throw new Error(`Unknown table ${table}`);
  return resource;
}
