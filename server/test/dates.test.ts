import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isMaintenanceDue, kampalaToday } from '../lib/dates';

/** Fixed instants: 2026-09-26 23:30 UTC = 2026-09-27 02:30 in Kampala (UTC+3). */
const LATE_NIGHT_UTC = new Date('2026-09-26T23:30:00Z');
/** 2026-09-26 20:59 UTC = 2026-09-26 23:59 Kampala — still the same local day. */
const LATE_EVENING_UTC = new Date('2026-09-26T20:59:00Z');

test('kampalaToday rolls over at the Kampala day boundary, not the UTC one', () => {
  assert.equal(kampalaToday(LATE_NIGHT_UTC), '2026-09-27');
  assert.equal(kampalaToday(LATE_EVENING_UTC), '2026-09-26');
  // 2026-01-01 00:15 Kampala is still 2025-12-31 in UTC.
  assert.equal(kampalaToday(new Date('2025-12-31T21:15:00Z')), '2026-01-01');
});

test('addDays does calendar arithmetic without timezone drift', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-06-15', 90), '2026-09-13');
});

test('isMaintenanceDue compares on day boundaries (scheduled day counts as due)', () => {
  const today = '2026-09-26';
  assert.equal(isMaintenanceDue('2026-09-26', today), true);
  assert.equal(isMaintenanceDue('2026-09-25', today), true);
  assert.equal(isMaintenanceDue('2026-09-27', today), false);
});

test('isMaintenanceDue treats empty and missing schedules as not due', () => {
  assert.equal(isMaintenanceDue(null), false);
  assert.equal(isMaintenanceDue(undefined), false);
  assert.equal(isMaintenanceDue(''), false);
});
