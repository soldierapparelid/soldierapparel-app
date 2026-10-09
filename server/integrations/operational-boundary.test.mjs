import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperationalSummary, integrationPolicy } from './operational-boundary.mjs';
const valid = () => ({ ordersPending: 2, unitsAvailable: 30, unitsInProduction: 8, unitsAwaitingQc: 4 });
test('only four validated operational counts can cross the boundary', () => {
  const input = valid(), result = validateOperationalSummary(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.ok(Object.isFrozen(result));
});
test('rejects credentials, financial fields, personal data and arbitrary text without echoing input', () => {
  for (const key of ['password', 'access_token', 'refresh_token', 'partner_key', 'apiKey',
    'revenue', 'balance', 'bankAccount', 'payroll', 'customerName', 'prompt', '__proto__']) {
    const input = valid();
    Object.defineProperty(input, key, { value: 'synthetic-sensitive-value', enumerable: true });
    assert.throws(() => validateOperationalSummary(input), { message: 'Integration data rejected' });
  }
});
test('rejects nested values, coercion, unsafe numbers and missing fields', () => {
  for (const value of ['2', {}, [], null, true, NaN, Infinity, -1, 1.5, 1000000001]) {
    assert.throws(() => validateOperationalSummary({ ...valid(), ordersPending: value }));
  }
  const input = valid(); delete input.unitsAvailable;
  assert.throws(() => validateOperationalSummary(input));
  assert.throws(() => validateOperationalSummary(Object.assign(Object.create(null), valid())));
  assert.throws(() => validateOperationalSummary({ ...valid(), [Symbol('extra')]: 1 }));
});
test('rejects getters and proxies without executing user code', () => {
  const input = valid();
  Object.defineProperty(input, 'ordersPending', { get() { throw new Error('getter executed'); } });
  assert.throws(() => validateOperationalSummary(input), { message: 'Integration data rejected' });
  const proxy = new Proxy(valid(), { getPrototypeOf() { throw new Error('trap executed'); } });
  assert.throws(() => validateOperationalSummary(proxy), { message: 'Integration data rejected' });
});
test('live connections, financial data and mutations stay disabled', () => {
  const policy = integrationPolicy();
  assert.equal(policy.liveConnectionsEnabled, false);
  assert.equal(policy.financialDataAllowed, false);
  assert.equal(policy.mutationsAllowed, false);
  assert.deepEqual(policy.tools, ['get_operational_summary']);
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.tools));
});
