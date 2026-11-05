const test = require('node:test');
const assert = require('node:assert');
const authCache = require('../src/auth/authCache');

test('schoolStatus queries once per school within the TTL, and caches "not found"', async () => {
  let calls = 0;
  const pc = { school: { findUnique: async ({ where }) => { calls++; return where.id === 'gone' ? null : { status: 'active' }; } } };
  assert.deepStrictEqual(await authCache.schoolStatus(pc, 'a'), { status: 'active' });
  assert.deepStrictEqual(await authCache.schoolStatus(pc, 'a'), { status: 'active' });
  assert.strictEqual(calls, 1);
  assert.strictEqual(await authCache.schoolStatus(pc, 'gone'), null);
  assert.strictEqual(await authCache.schoolStatus(pc, 'gone'), null);
  assert.strictEqual(calls, 2);
});

test('subject cache returns what was stored and evicts on demand', () => {
  assert.strictEqual(authCache.getSubject('tenant', 's1', 'u1'), undefined);
  authCache.setSubject('tenant', 's1', 'u1', { token_version: 3 });
  assert.deepStrictEqual(authCache.getSubject('tenant', 's1', 'u1'), { token_version: 3 });
  // a different school with the same user id never collides
  assert.strictEqual(authCache.getSubject('tenant', 's2', 'u1'), undefined);
  authCache.evictSubject('tenant', 's1', 'u1');
  assert.strictEqual(authCache.getSubject('tenant', 's1', 'u1'), undefined);
});
