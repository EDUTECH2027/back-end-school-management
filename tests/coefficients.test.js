const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCoefficients, coefficientsFor } = require('../src/utils/coefficients');
const { weightedSequenceAverages } = require('../src/utils/reportCardMath');
const { buildSheet } = require('../src/utils/yearEnd');

const subjects = [{ id: 'math', coefficient: 3 }, { id: 'art', coefficient: 1 }];

test('no overrides: every subject keeps its default (zero-regression guarantee)', () => {
  assert.deepEqual(resolveCoefficients({ subjects, classId: 'f1', gradeLevelId: 'g1' }), { math: 3, art: 1 });
  assert.deepEqual(resolveCoefficients({ subjects }), { math: 3, art: 1 });
});

test('Maths is ×4 in Form 1 and ×5 in Form 5 while other classes keep the default', () => {
  const overrides = [
    { subject_id: 'math', class_id: 'form1', grade_level_id: null, coefficient: 4 },
    { subject_id: 'math', class_id: 'form5', grade_level_id: null, coefficient: 5 },
  ];
  const at = (classId) => resolveCoefficients({ subjects, classId, overrides }).math;
  assert.equal(at('form1'), 4);
  assert.equal(at('form5'), 5);
  assert.equal(at('form3'), 3);
});

test('precedence: class override beats grade-level override beats default', () => {
  const overrides = [
    { subject_id: 'math', class_id: null, grade_level_id: 'g1', coefficient: 4 },
    { subject_id: 'math', class_id: 'f1b', grade_level_id: null, coefficient: 6 },
  ];
  const at = (classId) => resolveCoefficients({ subjects, classId, gradeLevelId: 'g1', overrides }).math;
  assert.equal(at('f1a'), 4); // inherits the grade-level setting
  assert.equal(at('f1b'), 6); // its own override wins
  assert.equal(resolveCoefficients({ subjects, classId: 'x', gradeLevelId: 'g2', overrides }).math, 3);
});

test('an override only affects its own subject', () => {
  const r = resolveCoefficients({ subjects, classId: 'f1', overrides: [{ subject_id: 'math', class_id: 'f1', coefficient: 4 }] });
  assert.equal(r.art, 1);
});

// A tiny fake Prisma client for the DB-facing wrapper.
function fakeDb({ classes, overrides }) {
  return {
    subject: { findMany: async (q) => (q?.where ? subjects.filter((s) => q.where.id.in.includes(s.id)) : subjects) },
    class: {
      findUnique: async ({ where }) =>
        classes.find((c) => (where.id ? c.id === where.id : c.name === where.name)) || null,
    },
    subjectCoefficientOverride: {
      findMany: async ({ where }) => overrides.filter((o) =>
        where.subject_id.in.includes(o.subject_id) &&
        where.OR.some((w) => (w.class_id && o.class_id === w.class_id) || (w.grade_level_id && o.grade_level_id === w.grade_level_id))),
    },
  };
}
const classes = [
  { id: 'f1', name: 'Form 1', grade_level_id: 'g1' },
  { id: 'f5', name: 'Form 5', grade_level_id: 'g5' },
];
const overrides = [
  { subject_id: 'math', class_id: 'f1', grade_level_id: null, coefficient: 4 },
  { subject_id: 'math', class_id: null, grade_level_id: 'g5', coefficient: 5 },
];

test('coefficientsFor resolves by class id, by class name (report cards), and falls back for unknown classes', async () => {
  const db = fakeDb({ classes, overrides });
  assert.equal((await coefficientsFor(db, { classId: 'f1' })).math, 4);
  assert.equal((await coefficientsFor(db, { className: 'Form 5' })).math, 5);
  assert.equal((await coefficientsFor(db, { className: 'Gone' })).math, 3);
  assert.equal((await coefficientsFor(db, {})).math, 3);
  assert.deepEqual(Object.keys(await coefficientsFor(db, { classId: 'f1', subjectIds: ['art'] })), ['art']);
});

test('the same marks give different weighted averages in classes with different coefficients', () => {
  const rows = (math) => [{ ca_score: 80, exam_score: 80, coefficient: math }, { ca_score: 40, exam_score: 40, coefficient: 1 }];
  assert.equal(weightedSequenceAverages(rows(4)).termAverage, 72); // (320+40)/5
  assert.equal(weightedSequenceAverages(rows(5)).termAverage, 73.3); // (400+40)/6

  // …and through the master sheet, per class
  const terms = [{ id: 't1', name: 'first' }];
  const students = [{ id: 's', first_name: 'A', last_name: 'B', student_number: 'M1' }];
  const marks = [
    { student_id: 's', subject_id: 'math', subject_name: 'Maths', term_id: 't1', ca_score: 80, exam_score: 80, total_score: 80 },
    { student_id: 's', subject_id: 'art', subject_name: 'Art', term_id: 't1', ca_score: 40, exam_score: 40, total_score: 40 },
  ];
  const avg = (math) => buildSheet({ students, terms, marks, coefficientById: { math, art: 1 }, termId: 't1' }).rows[0].average;
  assert.equal(avg(4), 72);
  assert.equal(avg(5), 73.3);
});
