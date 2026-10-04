// Server-only data boundary. No network, credentials, storage or financial tools.
import { isProxy } from 'node:util/types';

const fields = ['ordersPending', 'unitsAvailable', 'unitsInProduction', 'unitsAwaitingQc'];
const denied = () => new Error('Integration data rejected');
export function validateOperationalSummary(input) {
  if (!input || typeof input !== 'object' || isProxy(input) ||
      Object.getPrototypeOf(input) !== Object.prototype) throw denied();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw denied();
  const result = {};
  for (const key of fields) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw denied();
    const value = descriptor.value;
    if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) throw denied();
    result[key] = value;
  }
  return Object.freeze(result);
}
export function integrationPolicy() {
  return Object.freeze({
    liveConnectionsEnabled: false,
    financialDataAllowed: false,
    mutationsAllowed: false,
    tools: Object.freeze(['get_operational_summary'])
  });
}
