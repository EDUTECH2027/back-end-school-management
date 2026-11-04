const test = require('node:test');
const assert = require('node:assert/strict');
const { withLiveEnrolled } = require('../src/utils/classCounts');

// Minimal stand-in for the Prisma client: 3 active + 1 inactive in c1, none in c2.
const students = [
  { class_id: 'c1', is_active: true }, { class_id: 'c1', is_active: true }, { class_id: 'c1', is_active: true },
  { class_id: 'c1', is_active: false }, { class_id: 'other', is_active: true },
];
const db = {
  student: {
    groupBy: async ({ where }) => {
      const n = {};
      students
        .filter((s) => where.class_id.in.includes(s.class_id) && s.is_active === where.is_active)
        .forEach((s) => { n[s.class_id] = (n[s.class_id] || 0) + 1; });
      return Object.entries(n).map(([class_id, c]) => ({ class_id, _count: { _all: c } }));
    },
  },
};

test('stale stored counter is replaced by the live count of active students', async () => {
  const out = await withLiveEnrolled(db, [
    { id: 'c1', name: 'Grade 1A', enrolled: 32, capacity: 35 },
    { id: 'c2', name: 'Grade 1B', enrolled: 12, capacity: 35 },
  ]);
  assert.deepEqual(out.map((c) => c.enrolled), [3, 0]);
  assert.equal(out[0].capacity, 35); // everything else untouched
  assert.equal(out[0].name, 'Grade 1A');
});

test('works for a single class object and for an empty list', async () => {
  assert.equal((await withLiveEnrolled(db, { id: 'c1', enrolled: 99 })).enrolled, 3);
  assert.deepEqual(await withLiveEnrolled(db, []), []);
});
