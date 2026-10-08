import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../validation/common';
import { expensesResource, inventoryResource, jobsResource } from '../validation/resources';

test('parseBody rejects unknown fields instead of dropping them', () => {
  try {
    parseBody(jobsResource.create, { customerId: 'c1', serviceId: 's1', branchId: 'b1', date: '2026-09-26', revenue: 1 });
    assert.fail('expected branchId to be rejected');
  } catch (error) {
    assert.equal((error as { fields?: Record<string, string> }).fields?.branchId, 'Unknown field');
  }
});

test('branches are gone from every write schema (single shop)', () => {
  const shapes = [jobsResource.create, expensesResource.create, inventoryResource.create];
  for (const schema of shapes) {
    const keys = Object.keys((schema as unknown as { shape: Record<string, unknown> }).shape ?? {});
    assert.ok(!keys.includes('branchId'), `schema still accepts branchId: ${keys.join(',')}`);
  }
});

test('money preprocessing keeps null and empty string as errors, not zero', () => {
  assert.throws(() => parseBody(expensesResource.create, { category: 'Rent', description: 'x', amount: null }));
  assert.throws(() => parseBody(expensesResource.create, { category: 'Rent', description: 'x', amount: '' }));
  const parsed = parseBody(expensesResource.create, { category: 'Rent', description: 'x', amount: '1500' }) as { amount: number };
  assert.equal(parsed.amount, 1500);
});

test('expense date is optional but must be YYYY-MM-DD when present', () => {
  assert.throws(() => parseBody(expensesResource.create, { category: 'Rent', description: 'x', amount: 1, date: '26-09-2026' }));
  const parsed = parseBody(expensesResource.create, { category: 'Rent', description: 'x', amount: 1 }) as { date?: string };
  assert.equal(parsed.date, undefined);
});

test('job equipment usage entries require equipmentId and numeric hours', () => {
  const parsed = parseBody(jobsResource.create, {
    customerId: 'c1',
    serviceId: 's1',
    date: '2026-09-26',
    revenue: 10,
    equipmentUsage: [{ equipmentId: 'a1', hours: '2.5' }],
  }) as { equipmentUsage: Array<{ equipmentId: string; hours: number }> };
  assert.deepEqual(parsed.equipmentUsage, [{ equipmentId: 'a1', hours: 2.5 }]);
});

test('patch schemas demand at least one field', () => {
  assert.throws(() => parseBody(jobsResource.patch!, {}));
  const patched = parseBody(jobsResource.patch!, { status: 'Completed' }) as { status: string };
  assert.equal(patched.status, 'Completed');
});
