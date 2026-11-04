// Run with: npm test   (node --test, no database required)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSheet, subjectLeaders, classStats, proposeStatus, resolveNextClass,
  planTransition, summarizePlan, applyPlan, competitionRanks,
} = require('../src/utils/yearEnd');
const authorize = require('../src/middleware/authorize');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const terms = [
  { id: 't1', name: 'first' }, { id: 't2', name: 'second' }, { id: 't3', name: 'third' },
];
const stu = (id, first, last) => ({ id, first_name: first, last_name: last, student_number: `M-${id}` });
const students = [stu('a', 'Ann', 'Alpha'), stu('b', 'Bob', 'Beta'), stu('c', 'Cy', 'Gamma'), stu('d', 'Di', 'Delta')];
// subject math (coef 2) and art (coef 1)
const coefficientById = { math: 2, art: 1 };
const mk = (student, subject, term, ca, exam) => ({
  student_id: student, subject_id: subject, subject_name: subject, term_id: term,
  ca_score: ca, exam_score: exam, total_score: Math.round((ca + exam) / 2),
});
// a & b tie exactly on everything; c is weaker; d only has terms 1–2 (incomplete)
function marksFor(id, math, art, termIds = ['t1', 't2', 't3']) {
  return termIds.flatMap((t) => [mk(id, 'math', t, math, math), mk(id, 'art', t, art, art)]);
}
const marks = [...marksFor('a', 80, 60), ...marksFor('b', 80, 60), ...marksFor('c', 40, 30), ...marksFor('d', 90, 90, ['t1', 't2'])];

// ── Ranking & master sheet ────────────────────────────────────────────────────
test('competition ranking gives tied values a shared position', () => {
  const r = competitionRanks([{ v: 90 }, { v: 90 }, { v: 70 }, { v: null }], (x) => x.v);
  assert.deepEqual([...r.values()], [1, 1, 3]);
});

test('annual average uses the existing weighted formula; ties share rank 1', () => {
  const sheet = buildSheet({ students, terms, marks, coefficientById });
  const by = Object.fromEntries(sheet.rows.map((r) => [r.studentId, r]));
  // (80*2 + 60*1) / 3 = 73.3
  assert.equal(by.a.average, 73.3);
  assert.equal(by.b.average, 73.3);
  assert.equal(by.a.rank, 1);
  assert.equal(by.b.rank, 1);
  assert.equal(by.c.average, 36.7);
});

test('best student: both tied students are reported', () => {
  const sheet = buildSheet({ students, terms, marks, coefficientById });
  const best = sheet.rows.filter((r) => r.rank === 1).map((r) => r.studentId).sort();
  assert.deepEqual(best, ['a', 'b']);
});

test('incomplete results (missing term) are flagged and get no official average', () => {
  const sheet = buildSheet({ students, terms, marks, coefficientById });
  const d = sheet.rows.find((r) => r.studentId === 'd');
  assert.equal(d.complete, false);
  assert.equal(d.termsFound, 2);
  assert.equal(d.provisional, true);
  assert.match(d.issues[0], /third term/);
});

test('single-term view ranks on that term and needs no other term', () => {
  const sheet = buildSheet({ students, terms, marks, coefficientById, termId: 't1' });
  const d = sheet.rows.find((r) => r.studentId === 'd');
  assert.equal(d.complete, true);
  assert.equal(d.average, 90);
  assert.equal(d.rank, 1);
});

test('a missing subject mark counts as 0 but keeps its coefficient (report-card parity)', () => {
  const partial = marks.filter((m) => !(m.student_id === 'b' && m.subject_id === 'art' && m.term_id === 't1'));
  const sheet = buildSheet({ students, terms, marks: partial, coefficientById, termId: 't1' });
  const b = sheet.rows.find((r) => r.studentId === 'b');
  assert.equal(b.average, 53.3); // (80*2 + 0*1) / 3
  assert.equal(b.complete, false);
});

test('subject leaders: best, top three by position, ties share a position', () => {
  const sheet = buildSheet({ students, terms, marks, coefficientById, termId: 't1' });
  const math = subjectLeaders(sheet).find((l) => l.subjectId === 'math');
  // math marks: d 90, a 80, b 80, c 40 → positions 1, 2, 2, 4
  assert.deepEqual(math.best.map((b) => b.studentId), ['d']);
  assert.deepEqual(
    math.top.map((t) => `${t.studentId}:${t.rank}`).sort(),
    ['a:2', 'b:2', 'd:1'],
  );
  assert.equal(math.coefficient, 2);
  assert.ok(!math.top.some((t) => t.studentId === 'c'), 'position 4 is outside the top three');
});

test('subject leaders: a tie for best is reported as several best students', () => {
  const sheet = buildSheet({ students, terms, marks, coefficientById, termId: 't3' });
  const art = subjectLeaders(sheet).find((l) => l.subjectId === 'art');
  assert.deepEqual(art.best.map((b) => b.studentId).sort(), ['a', 'b']);
});

test('class stats: average, extremes, distribution, status counts', () => {
  const sheet = buildSheet({ students, terms, marks, coefficientById });
  const stats = classStats(sheet, [
    { status: 'promoted' }, { status: 'promoted' }, { status: 'repeating' }, { status: 'pending_review' },
  ]);
  assert.equal(stats.studentCount, 4);
  assert.equal(stats.highestAverage, 73.3);
  assert.equal(stats.promoted, 2);
  assert.equal(stats.promotedPct, 50);
  assert.equal(stats.repeating, 1);
  assert.equal(stats.pendingReview, 1);
  assert.equal(Object.values(stats.distribution).reduce((a, b) => a + b, 0), stats.gradedCount);
});

// ── Status proposal ───────────────────────────────────────────────────────────
test('proposal: pass mark is configurable; incomplete results are never auto-decided', () => {
  assert.equal(proposeStatus({ average: 50, complete: true }, 50).status, 'promoted');
  assert.equal(proposeStatus({ average: 49.9, complete: true }, 50).status, 'repeating');
  assert.equal(proposeStatus({ average: 49.9, complete: true }, 40).status, 'promoted');
  const inc = proposeStatus({ average: 80, complete: false, incompleteReason: 'No marks for the third term' }, 50);
  assert.equal(inc.status, 'pending_review');
  assert.match(inc.reason, /third term/);
});

// ── Next-class resolution ─────────────────────────────────────────────────────
const levels = [{ id: 'g1', name: 'Form 1', sort_order: 1 }, { id: 'g2', name: 'Form 2', sort_order: 2 }, { id: 'g3', name: 'Form 3', sort_order: 3 }];
const classes = [
  { id: 'c1a', name: 'Form 1A', grade_level_id: 'g1', capacity: 40 }, { id: 'c1b', name: 'Form 1B', grade_level_id: 'g1', capacity: 40 },
  { id: 'c2a', name: 'Form 2A', grade_level_id: 'g2', capacity: 40 }, { id: 'c2b', name: 'Form 2B', grade_level_id: 'g2', capacity: 40 },
  { id: 'c3', name: 'Form 3', grade_level_id: 'g3', capacity: 40 },
  { id: 'x', name: 'Club', grade_level_id: null, capacity: 40 },
];
const cl = (id) => classes.find((c) => c.id === id);

test('next class: same-section match, single-class level, final class, unresolved', () => {
  assert.deepEqual(resolveNextClass({ cls: cl('c1a'), classes, gradeLevels: levels }), { kind: 'class', classId: 'c2a' });
  assert.deepEqual(resolveNextClass({ cls: cl('c1b'), classes, gradeLevels: levels }), { kind: 'class', classId: 'c2b' });
  assert.deepEqual(resolveNextClass({ cls: cl('c2a'), classes, gradeLevels: levels }), { kind: 'class', classId: 'c3' });
  assert.deepEqual(resolveNextClass({ cls: cl('c3'), classes, gradeLevels: levels }), { kind: 'final' });
  assert.equal(resolveNextClass({ cls: cl('x'), classes, gradeLevels: levels }).kind, 'unresolved');
  // explicit configuration and per-student override win over inference
  assert.equal(resolveNextClass({ cls: { ...cl('c1a'), next_class_id: 'c2b' }, classes, gradeLevels: levels }).classId, 'c2b');
  assert.equal(resolveNextClass({ cls: cl('c1a'), classes, gradeLevels: levels, studentTargetId: 'c2b' }).classId, 'c2b');
  assert.equal(resolveNextClass({ cls: { ...cl('c1a'), is_final_class: true }, classes, gradeLevels: levels }).kind, 'final');
});

// ── Transition: plan + apply against an in-memory transaction client ─────────
function fakeDb(studentRows, decisionRows) {
  const db = {
    students: new Map(studentRows.map((s) => [s.id, { ...s }])),
    decisions: new Map(decisionRows.map((d) => [d.id, { ...d }])),
    enrollments: [], audit: [], classes: new Map(classes.map((c) => [c.id, { ...c }])),
  };
  db.tx = {
    student: {
      findUnique: async ({ where }) => db.students.get(where.id) || null,
      update: async ({ where, data }) => Object.assign(db.students.get(where.id), data),
      count: async ({ where }) => [...db.students.values()].filter((s) => s.class_id === where.class_id && s.is_active).length,
    },
    classEnrollment: {
      findUnique: async ({ where }) => {
        const k = where.enrollment_student_year;
        return db.enrollments.find((e) => e.student_id === k.student_id && e.academic_year_id === k.academic_year_id) || null;
      },
      create: async ({ data }) => {
        if (db.enrollments.some((e) => e.student_id === data.student_id && e.academic_year_id === data.academic_year_id)) throw new Error('unique violation');
        db.enrollments.push({ ...data });
        return data;
      },
    },
    yearEndDecision: {
      findUnique: async ({ where }) => db.decisions.get(where.id) || null,
      update: async ({ where, data }) => Object.assign(db.decisions.get(where.id), data),
    },
    yearEndAudit: { create: async ({ data }) => { db.audit.push(data); return data; } },
    class: { update: async ({ where, data }) => Object.assign(db.classes.get(where.id), data) },
  };
  return db;
}

const dec = (id, studentId, status, extra = {}) => ({
  id, student_id: studentId, status, proposed_status: status,
  validated_at: status === 'pending_review' ? null : new Date(), applied_at: null, target_class_id: null, ...extra,
});
const studentRow = (id, classId) => ({
  id, student_number: `M-${id}`, first_name: id, last_name: 'X', guardian_name: `Guardian of ${id}`,
  class_id: classId, class_name: cl(classId).name, grade_level_name: 'Form 1', is_active: true,
});

async function run(db, cls, nextYearEnrollments = new Map(), outcome = 'graduate') {
  let n = 0;
  const plan = planTransition({
    decisions: [...db.decisions.values()], cls, classes, gradeLevels: levels, finalClassOutcome: outcome, nextYearEnrollments,
  });
  const applied = await applyPlan(db.tx, {
    plan, sourceYearId: 'Y1', nextYearId: 'Y2', cls, classes,
    actor: { id: 'u1', name: 'Admin' }, runId: 'run1', newId: () => `id${++n}-${Math.random()}`,
  });
  return { plan, applied };
}

test('promoted student lands in the next class; repeater stays; profile data is preserved', async () => {
  const db = fakeDb(
    [studentRow('p', 'c1a'), studentRow('r', 'c1a'), studentRow('w', 'c1a')],
    [dec('d1', 'p', 'promoted'), dec('d2', 'r', 'repeating'), dec('d3', 'w', 'pending_review')],
  );
  const { applied } = await run(db, cl('c1a'));
  assert.equal(db.students.get('p').class_id, 'c2a');
  assert.equal(db.students.get('p').guardian_name, 'Guardian of p');
  assert.equal(db.students.get('p').student_number, 'M-p');
  assert.equal(db.students.get('r').class_id, 'c1a');
  assert.equal(db.students.get('w').class_id, 'c1a'); // pending → untouched
  assert.deepEqual([applied.promoted, applied.repeated, applied.skippedPending], [1, 1, 1]);
  // history: both years recorded, in the right classes
  const e = (s, y) => db.enrollments.find((x) => x.student_id === s && x.academic_year_id === y);
  assert.equal(e('p', 'Y1').class_id, 'c1a');
  assert.equal(e('p', 'Y2').class_id, 'c2a');
  assert.equal(e('r', 'Y2').class_id, 'c1a');
  assert.equal(e('w', 'Y2'), undefined);
  assert.equal(db.decisions.get('d3').applied_at, null);
  assert.ok(db.audit.length >= 2, 'each move is audited');
});

test('retrying the same confirmation creates no duplicate enrollments', async () => {
  const db = fakeDb([studentRow('p', 'c1a'), studentRow('r', 'c1a')], [dec('d1', 'p', 'promoted'), dec('d2', 'r', 'repeating')]);
  await run(db, cl('c1a'));
  const before = db.enrollments.length;
  const second = await run(db, cl('c1a'));
  assert.equal(db.enrollments.length, before);
  assert.equal(second.applied.alreadyApplied, 2);
  assert.equal(second.applied.promoted, 0);
});

test('a half-applied earlier attempt is finished safely (enrollment already present)', async () => {
  const db = fakeDb([studentRow('p', 'c1a')], [dec('d1', 'p', 'promoted')]);
  db.enrollments.push({ id: 'pre', student_id: 'p', class_id: 'c2a', academic_year_id: 'Y2' });
  await run(db, cl('c1a'), new Map([['p', { id: 'pre', class_id: 'c2a' }]]));
  assert.equal(db.enrollments.filter((e) => e.student_id === 'p' && e.academic_year_id === 'Y2').length, 1);
  assert.equal(db.students.get('p').class_id, 'c2a');
});

test('existing new-year enrollment in a different class blocks the transition', async () => {
  const db = fakeDb([studentRow('p', 'c1a')], [dec('d1', 'p', 'promoted')]);
  const plan = planTransition({
    decisions: [...db.decisions.values()], cls: cl('c1a'), classes, gradeLevels: levels, finalClassOutcome: 'graduate',
    nextYearEnrollments: new Map([['p', { id: 'pre', class_id: 'c2b' }]]),
  });
  assert.equal(plan[0].blockers.length, 1);
  await assert.rejects(() => applyPlan(db.tx, {
    plan, sourceYearId: 'Y1', nextYearId: 'Y2', cls: cl('c1a'), classes, actor: { id: 'u' }, runId: 'r', newId: () => 'z',
  }));
});

test('unvalidated decisions are never moved, even if their proposal says promoted', () => {
  const d = dec('d1', 'p', 'promoted', { validated_at: null, status: 'pending_review', proposed_status: 'promoted' });
  const plan = planTransition({ decisions: [d], cls: cl('c1a'), classes, gradeLevels: levels, finalClassOutcome: 'graduate' });
  assert.equal(plan[0].action, 'skip_pending');
});

test('final class: graduate leaves the active roll; hold leaves the student untouched', async () => {
  const mkDb = () => fakeDb([studentRow('g', 'c3')], [dec('d1', 'g', 'promoted')]);
  const db = mkDb();
  await run(db, cl('c3'));
  assert.equal(db.students.get('g').is_active, false);
  assert.equal(db.students.get('g').class_id, 'c3'); // history intact
  const held = mkDb();
  const { applied } = await run(held, cl('c3'), new Map(), 'hold');
  assert.equal(held.students.get('g').is_active, true);
  assert.equal(applied.held, 1);
});

test('unresolved destination is a blocker, not a silent guess', () => {
  const plan = planTransition({ decisions: [dec('d1', 'p', 'promoted')], cls: cl('x'), classes, gradeLevels: levels, finalClassOutcome: 'graduate' });
  assert.equal(plan[0].blockers.length, 1);
  assert.equal(summarizePlan(plan).blocked, 1);
});

test('capacity overflow warns but does not block', () => {
  const decisions = ['1', '2', '3'].map((n) => dec('d' + n, 's' + n, 'promoted'));
  const small = [{ ...cl('c1a'), next_class_id: 'c1b' }, { ...cl('c1b'), capacity: 2 }];
  const plan = planTransition({ decisions, cls: small[0], classes: small, gradeLevels: levels, finalClassOutcome: 'graduate' });
  assert.ok(plan.every((p) => p.blockers.length === 0 && p.warnings.length === 1));
});

test('withdrawn / transferred students leave the roll without a new enrollment', async () => {
  const db = fakeDb([studentRow('w', 'c1a'), studentRow('t', 'c1a')], [dec('d1', 'w', 'withdrawn'), dec('d2', 't', 'transferred')]);
  const { applied } = await run(db, cl('c1a'));
  assert.equal(applied.exited, 2);
  assert.equal(db.enrollments.filter((e) => e.academic_year_id === 'Y2').length, 0);
  assert.equal(db.students.get('w').is_active, false);
});

// ── Authorization ─────────────────────────────────────────────────────────────
test('only school administrators pass the route guard', () => {
  const guard = authorize('super_admin');
  const attempt = (user) => {
    let status = 200;
    let nexted = false;
    guard({ user }, { status: (s) => ({ json: () => { status = s; } }) }, () => { nexted = true; });
    return nexted ? 200 : status;
  };
  assert.equal(attempt({ role: 'super_admin' }), 200);
  assert.equal(attempt({ role: 'head_teacher' }), 200);
  for (const role of ['teacher', 'student', 'parent']) assert.equal(attempt({ role }), 403, role);
  assert.equal(attempt(undefined), 401);
});

test('every end-of-year route is behind authenticate + authorize', () => {
  const router = require('../src/routes/endOfYear');
  const layers = router.stack.filter((l) => l.route);
  assert.ok(layers.length >= 15);
  for (const l of layers) {
    const names = l.route.stack.map((s) => s.handle.name);
    assert.ok(names.includes('authenticate') && names.length >= 3, `${Object.keys(l.route.methods)} ${l.route.path} unguarded`);
  }
});
