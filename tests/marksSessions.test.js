const test = require('node:test');
const assert = require('node:assert/strict');

// The portal router pulls in config that needs a JWT secret to boot.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);
process.env.ALLOW_WEAK_SECRETS = 'true';

const teacherRouter = require('../src/routes/portal/teacher');

const route = (path, method) => teacherRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]).route;
const postMarks = route('/marks', 'post');
const handler = postMarks.stack[postMarks.stack.length - 1].handle; // the last layer is the actual handler

// Fake tenant DB. `open` = sequences whose session is open; `stored` = marks already saved.
function fakeDb({ open = [], stored = [], window = null, termName = 'first' }) {
  const upserts = [];
  return {
    upserts,
    teacher: { findUnique: async () => ({ class_assigned: null, subjects: ['Mathematics'] }) },
    teacherSchedule: { findMany: async () => [] },
    class: { findMany: async () => [{ id: 'c1', name: 'Form 1', class_teacher_id: 't1' }] },
    subject: { findMany: async () => [{ id: 'math', name: 'Mathematics' }] },
    term: { findUnique: async () => ({ name: termName }) },
    marksEntryPeriod: { findUnique: async () => window },
    marksEntrySession: { findMany: async () => open.map((sequence) => ({ sequence, is_open: true })) },
    mark: { findMany: async () => stored, upsert: (args) => { upserts.push(args); return Promise.resolve(args); } },
    $transaction: (ops) => Promise.all(ops),
  };
}

async function save(db, marks) {
  let status = 200; let body;
  const res = { status(code) { status = code; return this; }, json(b) { body = b; return this; } };
  await handler({ db, user: { teacher_id: 't1' }, body: { classId: 'c1', termId: 'term1', marks } }, res);
  return { status, body };
}

const row = (ca, exam) => ({ student_id: 's1', subject_id: 'math', ca_score: ca, exam_score: exam });

test('nothing open: saving is refused', async () => {
  const r = await save(fakeDb({ open: [] }), [row(10, 0)]);
  assert.equal(r.status, 403);
  assert.match(r.body.error, /closed/i);
});

test('only Sequence 1 open: first mark may change, second may not', async () => {
  const ok = await save(fakeDb({ open: [1] }), [row(14, 0)]);
  assert.equal(ok.status, 200);
  const blocked = await save(fakeDb({ open: [1] }), [row(14, 9)]);
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /Sequence 2/);
});

test('only Sequence 2 open: first mark may not change, second may', async () => {
  const blocked = await save(fakeDb({ open: [2] }), [row(14, 9)]);
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /Sequence 1/);
  const ok = await save(fakeDb({ open: [2], stored: [{ student_id: 's1', subject_id: 'math', ca_score: 14, exam_score: 0 }] }), [row(14, 9)]);
  assert.equal(ok.status, 200); // the closed first mark was resent unchanged
});

test('a closed sequence keeps its stored value even if the screen resends it untouched', async () => {
  const stored = [{ student_id: 's1', subject_id: 'math', ca_score: 12, exam_score: 0 }];
  const ok = await save(fakeDb({ open: [2], stored }), [row(12, 15)]);
  assert.equal(ok.status, 200);
  const tampered = await save(fakeDb({ open: [2], stored }), [row(19, 15)]);
  assert.equal(tampered.status, 403);
});

test('sessions are per sequence: opening Sequence 3 does not open Term 1', async () => {
  const r = await save(fakeDb({ open: [3] }), [row(10, 0)]); // term "first" = sequences 1-2
  assert.equal(r.status, 403);
  const t2 = await save(fakeDb({ open: [3], termName: 'second' }), [row(10, 0)]); // term "second" = 3-4
  assert.equal(t2.status, 200);
});

test('an enforced time window that has passed still closes an open session', async () => {
  const past = { is_enabled: true, opens_at: new Date('2020-01-01'), closes_at: new Date('2020-02-01') };
  const r = await save(fakeDb({ open: [1, 2], window: past }), [row(10, 10)]);
  assert.equal(r.status, 403);
});
