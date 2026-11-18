import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrder } from '../api/create-order.js';

const base = {
  idempotencyKey: '3f1c2b9e-8a7d-4c1e-9b2a-1234567890ab',
  fullName: 'Jane Wanjiku', phone: '0712 345 678', deliveryMethod: 'pickup',
  items: [{ sku: 'cu1', quantity: 2 }]
};

test('accepts a valid pickup order and normalises the phone', () => {
  const r = validateOrder(base);
  assert.equal(r.error, null);
  assert.equal(r.payload.phone, '0712345678');
  assert.equal(r.payload.deliveryAddress, null);
});

test('requires address for delivery', () => {
  const r = validateOrder({ ...base, deliveryMethod: 'delivery', deliveryAddress: '' });
  assert.ok(r.fieldErrors.addr);
});

test('rejects invalid phone numbers', () => {
  for (const phone of ['12345', '0812345678', '+2547123', '']) {
    assert.ok(validateOrder({ ...base, phone }).fieldErrors.phone, phone);
  }
  for (const phone of ['+254712345678', '254112345678', '0112345678']) {
    assert.equal(validateOrder({ ...base, phone }).fieldErrors.phone, undefined, phone);
  }
});

test('drops malformed items, merges duplicates, ignores client prices', () => {
  const r = validateOrder({ ...base, items: [
    { sku: 'cu1', quantity: 1, price: 0 }, { sku: 'cu1', quantity: 2 },
    { sku: 'co1', quantity: -3 }, { sku: '<script>', quantity: 1 }, { sku: 'co2', quantity: 1.5 }
  ] });
  assert.deepEqual(r.payload.items, [{ sku: 'cu1', quantity: 3 }]);
  assert.equal('price' in r.payload.items[0], false);
});

test('requires items and a valid idempotency key', () => {
  assert.ok(validateOrder({ ...base, items: [] }).error);
  assert.ok(validateOrder({ ...base, idempotencyKey: 'abc' }).error);
});
