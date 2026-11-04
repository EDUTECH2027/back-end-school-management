/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// End-of-year module: promotion/repetition decisions, class master sheets, and the controlled
// transition of students into the next academic year. Admin-only — every rule is enforced here,
// the UI is only a convenience.
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const {
  TERM_NAMES, competitionRanks, buildSheet, subjectLeaders, classStats, proposeStatus,
  resolveNextClass, planTransition, summarizePlan, applyPlan,
} = require('../utils/yearEnd');
const { coefficientsFor } = require('../utils/coefficients');

const adminOnly = [authenticate, authorize('super_admin')];
const STATUSES = ['pending_review', 'promoted', 'repeating', 'withdrawn', 'transferred', 'graduated'];
const TX_OPTS = { timeout: 60000, maxWait: 10000 };

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const actorOf = (req) => ({ id: req.user.id, name: req.user.name || req.user.email });
const audit = (db, req, data) =>
  db.yearEndAudit.create({ data: { id: uuid(), actor_id: req.user.id, actor_name: req.user.name || req.user.email, ...data } });

// ── Loading helpers ────────────────────────────────────────────────────────────

async function getConfig(db) {
  return (await db.yearEndConfig.findUnique({ where: { id: 's1' } }))
    || db.yearEndConfig.create({ data: { id: 's1' } });
}

async function requireYearAndClass(db, yearId, classId) {
  if (!yearId || !classId) throw new HttpError(422, 'yearId and classId are required');
  const [year, cls] = await Promise.all([
    db.academicYear.findUnique({ where: { id: yearId } }),
    db.class.findUnique({ where: { id: classId } }),
  ]);
  if (!year) throw new HttpError(404, 'Academic year not found');
  if (!cls) throw new HttpError(404, 'Class not found');
  return { year, cls };
}

// Who belonged to this class during this year: recorded enrollments, anyone graded in the class
// that year, and — for data that predates enrollment tracking — active students placed in the
// class who have no enrollment row for the year at all.
async function loadCohort(db, year, cls) {
  const [enrolled, graded, untracked] = await Promise.all([
    db.classEnrollment.findMany({ where: { academic_year_id: year.id, class_id: cls.id }, select: { student_id: true } }),
    db.mark.findMany({ where: { class_id: cls.id, term: { academic_year_id: year.id } }, distinct: ['student_id'], select: { student_id: true } }),
    db.student.findMany({
      where: { class_id: cls.id, is_active: true, enrollments: { none: { academic_year_id: year.id } } },
      select: { id: true },
    }),
  ]);
  const ids = new Set([...enrolled.map((e) => e.student_id), ...graded.map((m) => m.student_id), ...untracked.map((s) => s.id)]);
  // A student already enrolled elsewhere this year (e.g. moved class) only counts where enrolled.
  const elsewhere = ids.size
    ? await db.classEnrollment.findMany({
        where: { academic_year_id: year.id, student_id: { in: [...ids] }, NOT: { class_id: cls.id } },
        select: { student_id: true },
      })
    : [];
  const moved = new Set(elsewhere.map((e) => e.student_id));
  const keep = [...ids].filter((id) => !moved.has(id));
  if (keep.length === 0) return [];
  return db.student.findMany({
    where: { id: { in: keep } },
    orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
    select: { id: true, first_name: true, middle_name: true, last_name: true, student_number: true, is_active: true },
  });
}

async function loadResults(db, year, cls, { termId = null } = {}) {
  const terms = await db.term.findMany({ where: { academic_year_id: year.id } });
  if (termId && !terms.some((t) => t.id === termId)) throw new HttpError(422, 'That term does not belong to the selected academic year');
  const [students, marks] = await Promise.all([
    loadCohort(db, year, cls),
    terms.length ? db.mark.findMany({ where: { class_id: cls.id, term_id: { in: terms.map((t) => t.id) } } }) : [],
  ]);
  const subjectIds = [...new Set(marks.map((m) => m.subject_id))];
  const coefficientById = subjectIds.length ? await coefficientsFor(db, { classId: cls.id, subjectIds }) : {};
  const sheet = buildSheet({ students, terms, marks, coefficientById, termId });
  return { terms, students, marks, sheet };
}

const decisionView = (d) => d && ({
  id: d.id, status: d.status, proposedStatus: d.proposed_status, validated: !!d.validated_at,
  validatedAt: d.validated_at, validatedBy: d.validated_by_name, isOverride: d.is_override,
  comment: d.comment, targetClassId: d.target_class_id, applied: !!d.applied_at, incompleteReason: d.incomplete_reason,
});

// ── Configuration ──────────────────────────────────────────────────────────────

router.get('/config', adminOnly, async (req, res) => {
  const c = await getConfig(req.db);
  res.json({ passAverage: c.pass_average, finalClassOutcome: c.final_class_outcome });
});

router.put('/config', adminOnly, async (req, res) => {
  const { passAverage, finalClassOutcome } = req.body;
  const pass = Number(passAverage);
  if (!Number.isFinite(pass) || pass < 0 || pass > 100) throw new HttpError(422, 'passAverage must be a number between 0 and 100');
  if (!['graduate', 'hold'].includes(finalClassOutcome)) throw new HttpError(422, "finalClassOutcome must be 'graduate' or 'hold'");
  const before = await getConfig(req.db);
  const saved = await req.db.yearEndConfig.update({
    where: { id: 's1' },
    data: { pass_average: pass, final_class_outcome: finalClassOutcome, updated_by: req.user.id, updated_at: new Date() },
  });
  await audit(req.db, req, {
    action: 'config_changed',
    details: { from: { passAverage: before.pass_average, finalClassOutcome: before.final_class_outcome }, to: { passAverage: pass, finalClassOutcome } },
  });
  res.json({ passAverage: saved.pass_average, finalClassOutcome: saved.final_class_outcome });
});

// Class progression map: which class promoted students move to.
router.get('/progression', adminOnly, async (req, res) => {
  const [classes, gradeLevels] = await Promise.all([
    req.db.class.findMany({ orderBy: { name: 'asc' } }),
    req.db.gradeLevel.findMany({ orderBy: { sort_order: 'asc' } }),
  ]);
  const byId = new Map(classes.map((c) => [c.id, c]));
  res.json(classes.map((c) => {
    const r = resolveNextClass({ cls: c, classes, gradeLevels });
    return {
      id: c.id, name: c.name, gradeLevelName: c.grade_level_name,
      nextClassId: c.next_class_id, isFinalClass: c.is_final_class,
      resolved: r.kind === 'class'
        ? { kind: 'class', classId: r.classId, className: byId.get(r.classId)?.name, configured: !!c.next_class_id }
        : r,
    };
  }));
});

router.put('/progression/:classId', adminOnly, async (req, res) => {
  const { nextClassId = null, isFinalClass = false } = req.body;
  const cls = await req.db.class.findUnique({ where: { id: req.params.classId } });
  if (!cls) throw new HttpError(404, 'Class not found');
  if (nextClassId) {
    if (nextClassId === cls.id) throw new HttpError(422, 'A class cannot be its own next class');
    if (!(await req.db.class.findUnique({ where: { id: nextClassId } }))) throw new HttpError(422, 'Next class not found');
  }
  const saved = await req.db.class.update({
    where: { id: cls.id },
    data: { next_class_id: isFinalClass ? null : (nextClassId || null), is_final_class: !!isFinalClass },
  });
  await audit(req.db, req, {
    action: 'mapping_changed', class_id: cls.id,
    details: { from: { nextClassId: cls.next_class_id, isFinalClass: cls.is_final_class }, to: { nextClassId: saved.next_class_id, isFinalClass: saved.is_final_class } },
  });
  res.json({ id: saved.id, nextClassId: saved.next_class_id, isFinalClass: saved.is_final_class });
});

// ── Closing a year ─────────────────────────────────────────────────────────────

router.post('/years/:id/close', adminOnly, async (req, res) => {
  const year = await req.db.academicYear.findUnique({ where: { id: req.params.id } });
  if (!year) throw new HttpError(404, 'Academic year not found');
  if (year.closed_at) return res.json({ id: year.id, closedAt: year.closed_at });
  const saved = await req.db.academicYear.update({ where: { id: year.id }, data: { closed_at: new Date() } });
  await audit(req.db, req, { action: 'year_closed', academic_year_id: year.id, details: { label: year.label } });
  res.json({ id: saved.id, closedAt: saved.closed_at });
});

router.post('/years/:id/reopen', adminOnly, async (req, res) => {
  const year = await req.db.academicYear.findUnique({ where: { id: req.params.id } });
  if (!year) throw new HttpError(404, 'Academic year not found');
  const live = await req.db.yearEndRun.count({ where: { academic_year_id: year.id, status: 'confirmed' } });
  if (live > 0) throw new HttpError(409, 'Cannot reopen: students have already been transitioned. Reverse those runs first.');
  await req.db.academicYear.update({ where: { id: year.id }, data: { closed_at: null } });
  await audit(req.db, req, { action: 'year_reopened', academic_year_id: year.id, details: { label: year.label } });
  res.json({ id: year.id, closedAt: null });
});

// ── Readiness (step 2: are the required marks there?) ──────────────────────────

router.get('/readiness', adminOnly, async (req, res) => {
  const { year, cls } = await requireYearAndClass(req.db, req.query.yearId, req.query.classId);
  const { terms, students, marks, sheet } = await loadResults(req.db, year, cls);
  const perTerm = TERM_NAMES.map((name) => {
    const t = terms.find((x) => x.name === name);
    if (!t) return { name, defined: false, subjects: 0, studentsGraded: 0 };
    const tm = marks.filter((m) => m.term_id === t.id);
    return {
      name, defined: true,
      subjects: new Set(tm.map((m) => m.subject_id)).size,
      studentsGraded: new Set(tm.map((m) => m.student_id)).size,
    };
  });
  const complete = sheet.rows.filter((r) => r.complete).length;
  const blockers = [];
  if (students.length === 0) blockers.push('No students found in this class for the selected year');
  if (marks.length === 0) blockers.push('No marks have been recorded for this class in the selected year');
  res.json({
    studentCount: students.length, terms: perTerm, completeStudents: complete, incompleteStudents: students.length - complete,
    yearClosed: !!year.closed_at, ready: blockers.length === 0, blockers,
  });
});

// ── Calculation (step 3) ───────────────────────────────────────────────────────

router.post('/calculate', adminOnly, async (req, res) => {
  const { year, cls } = await requireYearAndClass(req.db, req.body.yearId, req.body.classId);
  const config = await getConfig(req.db);
  const { students, marks, sheet } = await loadResults(req.db, year, cls);
  if (students.length === 0) throw new HttpError(422, 'No students found in this class for the selected year');
  if (marks.length === 0) throw new HttpError(422, 'No marks have been recorded for this class in the selected year');

  // Rank on official (all-terms) averages only.
  const ranks = competitionRanks(sheet.rows, (r) => (r.provisional ? null : r.average));
  const existing = await req.db.yearEndDecision.findMany({ where: { academic_year_id: year.id, student_id: { in: students.map((s) => s.id) } } });
  const existingByStudent = new Map(existing.map((d) => [d.student_id, d]));

  const counts = { created: 0, updated: 0, locked: 0, proposed: { promoted: 0, repeating: 0, pending_review: 0 } };
  await req.db.$transaction(async (tx) => {
    for (const row of sheet.rows) {
      const official = row.provisional ? null : row.average;
      const proposal = proposeStatus({ average: official, complete: row.complete, incompleteReason: row.issues[0] }, config.pass_average);
      counts.proposed[proposal.status] += 1;
      const calc = {
        class_id: cls.id, class_name: cls.name, calculated_average: official, terms_found: row.termsFound,
        class_rank: ranks.get(row) ?? null, is_complete: row.complete, incomplete_reason: proposal.reason,
        proposed_status: proposal.status, updated_at: new Date(),
      };
      const prior = existingByStudent.get(row.studentId);
      if (!prior) {
        await tx.yearEndDecision.create({ data: { id: uuid(), academic_year_id: year.id, student_id: row.studentId, ...calc } });
        counts.created += 1;
      } else if (prior.applied_at) {
        counts.locked += 1; // already transitioned — never recalculated
      } else {
        await tx.yearEndDecision.update({
          where: { id: prior.id },
          data: { ...calc, ...(prior.validated_at && { is_override: prior.status !== proposal.status }) },
        });
        counts.updated += 1;
      }
    }
    await audit(tx, req, {
      action: 'calculated', academic_year_id: year.id, class_id: cls.id,
      details: { passAverage: config.pass_average, ...counts },
    });
  }, TX_OPTS);

  res.json({ passAverage: config.pass_average, ...counts });
});

// ── Review (step 4) ────────────────────────────────────────────────────────────

router.get('/decisions', adminOnly, async (req, res) => {
  const { year, cls } = await requireYearAndClass(req.db, req.query.yearId, req.query.classId);
  const { sheet } = await loadResults(req.db, year, cls);
  const decisions = await req.db.yearEndDecision.findMany({
    where: { academic_year_id: year.id, student_id: { in: sheet.rows.map((r) => r.studentId) } },
  });
  const byStudent = new Map(decisions.map((d) => [d.student_id, d]));
  const config = await getConfig(req.db);
  res.json({
    passAverage: config.pass_average,
    yearClosed: !!year.closed_at,
    calculated: decisions.length > 0,
    rows: sheet.rows.map((r) => {
      const d = byStudent.get(r.studentId);
      return {
        studentId: r.studentId, name: r.name, matricule: r.matricule,
        average: d ? d.calculated_average : (r.provisional ? null : r.average),
        rank: d?.class_rank ?? null, termsFound: r.termsFound, complete: r.complete, issues: r.issues,
        decision: decisionView(d) || null,
      };
    }),
  });
});

router.put('/decisions/:id', adminOnly, async (req, res) => {
  const { status, comment, targetClassId } = req.body;
  if (!STATUSES.includes(status)) throw new HttpError(422, `status must be one of: ${STATUSES.join(', ')}`);
  const d = await req.db.yearEndDecision.findUnique({ where: { id: req.params.id } });
  if (!d) throw new HttpError(404, 'Decision not found');
  if (d.applied_at) throw new HttpError(409, 'This student has already been transitioned. Reverse the run to change the decision.');

  const note = String(comment || '').trim();
  const data = { updated_at: new Date() };
  if (status === 'pending_review') {
    Object.assign(data, { status, validated_at: null, validated_by: null, validated_by_name: null, is_override: false });
  } else {
    const override = status !== d.proposed_status;
    if (override && !note) throw new HttpError(422, 'A comment is required when the decision differs from the system proposal (or the results are incomplete)');
    Object.assign(data, {
      status, validated_at: new Date(), validated_by: req.user.id, validated_by_name: req.user.name || req.user.email, is_override: override,
    });
  }
  if (comment !== undefined) data.comment = note || null;
  if (targetClassId !== undefined) {
    if (targetClassId && !(await req.db.class.findUnique({ where: { id: targetClassId } }))) throw new HttpError(422, 'Destination class not found');
    data.target_class_id = status === 'promoted' ? (targetClassId || null) : null;
  }
  const saved = await req.db.yearEndDecision.update({ where: { id: d.id }, data });
  await audit(req.db, req, {
    action: status === 'pending_review' ? 'unvalidated' : (data.is_override ? 'overridden' : 'validated'),
    academic_year_id: d.academic_year_id, class_id: d.class_id, student_id: d.student_id,
    details: { from: d.status, to: status, proposed: d.proposed_status, comment: note || null, targetClassId: data.target_class_id ?? d.target_class_id },
  });
  res.json(decisionView(saved));
});

// Bulk "accept the system's proposal" — only for students with complete results.
router.post('/decisions/accept-proposals', adminOnly, async (req, res) => {
  const { year, cls } = await requireYearAndClass(req.db, req.body.yearId, req.body.classId);
  const now = new Date();
  let accepted = 0;
  // `status` mirrors each row's own proposal, hence one update per proposal value.
  for (const s of ['promoted', 'repeating']) {
    const r = await req.db.yearEndDecision.updateMany({
      where: { academic_year_id: year.id, class_id: cls.id, applied_at: null, validated_at: null, is_complete: true, proposed_status: s },
      data: {
        status: s, validated_at: now, validated_by: req.user.id, validated_by_name: req.user.name || req.user.email,
        is_override: false, updated_at: now,
      },
    });
    accepted += r.count;
  }
  await audit(req.db, req, { action: 'validated', academic_year_id: year.id, class_id: cls.id, details: { bulk: true, accepted } });
  res.json({ accepted });
});

// ── Master sheet ───────────────────────────────────────────────────────────────

router.get('/master-sheet', adminOnly, async (req, res) => {
  const { yearId, classId, termId, subjectId } = req.query;
  const { year, cls } = await requireYearAndClass(req.db, yearId, classId);
  const { terms, sheet } = await loadResults(req.db, year, cls, { termId: termId || null });
  const decisions = await req.db.yearEndDecision.findMany({
    where: { academic_year_id: year.id, student_id: { in: sheet.rows.map((r) => r.studentId) } },
  });
  const byStudent = new Map(decisions.map((d) => [d.student_id, d]));

  const leaders = subjectLeaders(sheet, 3);
  const visibleSubjects = subjectId ? sheet.subjects.filter((s) => s.id === subjectId) : sheet.subjects;
  if (subjectId && visibleSubjects.length === 0) throw new HttpError(422, 'That subject has no marks for this class and period');

  const rows = sheet.rows.map((r) => {
    const d = byStudent.get(r.studentId);
    return {
      ...r,
      finalStatus: d && d.validated_at ? d.status : 'pending_review',
      statusValidated: !!(d && d.validated_at),
      proposedStatus: d?.proposed_status ?? null,
    };
  });
  const best = rows.filter((r) => r.rank === 1);
  const finalStatuses = decisions.filter((d) => d.validated_at);

  res.json({
    year: { id: year.id, label: year.label, closed: !!year.closed_at },
    class: { id: cls.id, name: cls.name },
    term: termId ? (terms.find((t) => t.id === termId)?.name ?? null) : null,
    provisional: rows.some((r) => r.provisional),
    subjects: visibleSubjects,
    rows,
    bestStudents: best.map((r) => ({
      studentId: r.studentId, name: r.name, matricule: r.matricule, average: r.average, rank: r.rank,
      weightedTotal: r.weightedTotal, termAverages: r.termAverages,
    })),
    subjectLeaders: subjectId ? leaders.filter((l) => l.subjectId === subjectId) : leaders,
    stats: classStats(sheet, finalStatuses),
  });
});

// ── Preview and confirmation (steps 6–8) ───────────────────────────────────────

async function loadPlan(db, { yearId, classId, nextYearId }) {
  const { year, cls } = await requireYearAndClass(db, yearId, classId);
  if (!nextYearId) throw new HttpError(422, 'nextYearId is required');
  const nextYear = await db.academicYear.findUnique({ where: { id: nextYearId } });
  if (!nextYear) throw new HttpError(404, 'Next academic year not found');

  const checks = [];
  const check = (ok, message) => checks.push({ ok, message });
  check(nextYear.id !== year.id, 'The next academic year differs from the closing year');
  check(String(nextYear.start_date) > String(year.start_date), 'The next academic year starts after the closing year');
  check(!nextYear.closed_at, 'The next academic year is open');
  check(!!year.closed_at, 'The closing academic year is closed');

  const [classes, gradeLevels, config, decisions] = await Promise.all([
    db.class.findMany(), db.gradeLevel.findMany(), getConfig(db),
    db.yearEndDecision.findMany({ where: { academic_year_id: year.id, class_id: cls.id }, include: { student: true } }),
  ]);
  const enr = decisions.length
    ? await db.classEnrollment.findMany({ where: { academic_year_id: nextYear.id, student_id: { in: decisions.map((d) => d.student_id) } } })
    : [];
  const plan = planTransition({
    decisions, cls, classes, gradeLevels, finalClassOutcome: config.final_class_outcome,
    nextYearEnrollments: new Map(enr.map((e) => [e.student_id, e])),
  });
  const studentById = new Map(decisions.map((d) => [d.student_id, d.student]));
  const decorated = plan.map((p) => {
    const s = studentById.get(p.studentId);
    return { ...p, name: s ? [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ') : p.studentId, matricule: s?.student_number };
  });
  check(decisions.length > 0, 'Final averages have been calculated for this class');
  check(!decorated.some((p) => p.blockers.length), 'Every validated student has a valid destination');
  return { year, nextYear, cls, classes, plan: decorated, rawPlan: plan, checks, summary: summarizePlan(plan), config };
}

router.get('/preview', adminOnly, async (req, res) => {
  const ctx = await loadPlan(req.db, req.query);
  const { year, nextYear, cls, plan, checks, summary } = ctx;
  res.json({
    year: { id: year.id, label: year.label }, nextYear: { id: nextYear.id, label: nextYear.label },
    class: { id: cls.id, name: cls.name },
    plan, summary, checks, canConfirm: checks.every((c) => c.ok) && summary.promote + summary.repeat + summary.graduate + summary.exit > 0,
    pendingCount: summary.skip_pending,
  });
});

router.post('/confirm', adminOnly, async (req, res) => {
  const ctx = await loadPlan(req.db, req.body);
  const failed = ctx.checks.filter((c) => !c.ok);
  if (failed.length) throw new HttpError(422, `Cannot confirm: ${failed[0].message}`, { code: 'CHECKS_FAILED' });

  const actor = actorOf(req);
  let applied;
  let run;
  try {
    ({ applied, run } = await req.db.$transaction(async (tx) => {
      // One run row per (year, class): a retry or a later pass for stragglers updates it in place.
      const prior = await tx.yearEndRun.findUnique({ where: { run_year_class: { academic_year_id: ctx.year.id, class_id: ctx.cls.id } } });
      const runId = prior?.id || uuid();
      const result = await applyPlan(tx, {
        plan: ctx.rawPlan, sourceYearId: ctx.year.id, nextYearId: ctx.nextYear.id, cls: ctx.cls, classes: ctx.classes,
        actor, runId, newId: uuid,
      });
      const totals = { ...(prior?.status === 'confirmed' ? prior.summary : {}) };
      Object.entries(result).forEach(([k, v]) => { if (k !== 'alreadyApplied' && k !== 'skippedPending') totals[k] = (totals[k] || 0) + v; });
      const data = {
        next_academic_year_id: ctx.nextYear.id, status: 'confirmed', confirmed_by: actor.id, confirmed_by_name: actor.name,
        confirmed_at: new Date(), reversed_by_name: null, reversed_at: null, note: req.body.note || prior?.note || null, summary: totals,
      };
      const saved = prior
        ? await tx.yearEndRun.update({ where: { id: prior.id }, data })
        : await tx.yearEndRun.create({ data: { id: runId, academic_year_id: ctx.year.id, class_id: ctx.cls.id, ...data } });
      await audit(tx, req, {
        action: 'confirmed', academic_year_id: ctx.year.id, class_id: ctx.cls.id, run_id: saved.id,
        details: { nextYearId: ctx.nextYear.id, ...result, note: req.body.note || null },
      });
      return { applied: result, run: saved };
    }, TX_OPTS));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(409, `Transition rolled back — nothing was changed. ${err.message}`);
  }
  res.status(200).json({
    run: { id: run.id, status: run.status, confirmedAt: run.confirmed_at, confirmedBy: run.confirmed_by_name, totals: run.summary },
    applied,
  });
});

// ── Reversal ───────────────────────────────────────────────────────────────────

router.post('/reverse', adminOnly, async (req, res) => {
  const { yearId, classId, reason } = req.body;
  const { year, cls } = await requireYearAndClass(req.db, yearId, classId);
  if (!String(reason || '').trim()) throw new HttpError(422, 'A reason is required to reverse a transition');
  const run = await req.db.yearEndRun.findUnique({ where: { run_year_class: { academic_year_id: year.id, class_id: cls.id } } });
  if (!run || run.status !== 'confirmed') throw new HttpError(404, 'No confirmed transition exists for this class and year');

  const applied = await req.db.yearEndDecision.findMany({ where: { academic_year_id: year.id, class_id: cls.id, applied_at: { not: null } } });

  // Refuse if the new year already has activity for these students — that would orphan real data.
  const nextTerms = await req.db.term.findMany({ where: { academic_year_id: run.next_academic_year_id }, select: { id: true } });
  const nextYear = await req.db.academicYear.findUnique({ where: { id: run.next_academic_year_id } });
  const ids = applied.map((d) => d.student_id);
  const [marksInNext, attendanceInNext] = await Promise.all([
    nextTerms.length && ids.length ? req.db.mark.findMany({ where: { student_id: { in: ids }, term_id: { in: nextTerms.map((t) => t.id) } }, select: { student_id: true }, distinct: ['student_id'] }) : [],
    nextYear && ids.length ? req.db.attendanceRecord.findMany({ where: { student_id: { in: ids }, date: { gte: nextYear.start_date } }, select: { student_id: true }, distinct: ['student_id'] }) : [],
  ]);
  const active = new Set([...marksInNext, ...attendanceInNext].map((x) => x.student_id));
  if (active.size) {
    throw new HttpError(409, `Cannot reverse: ${active.size} student(s) already have marks or attendance in the new academic year.`, { code: 'ACTIVITY_IN_NEW_YEAR' });
  }

  const actor = actorOf(req);
  let reverted = 0;
  const warnings = [];
  await req.db.$transaction(async (tx) => {
    for (const d of applied) {
      const snap = d.applied_snapshot || {};
      if (snap.next_enrollment_created && snap.next_enrollment_id) {
        await tx.classEnrollment.deleteMany({ where: { id: snap.next_enrollment_id } });
      }
      if (snap.source_enrollment_created) {
        await tx.classEnrollment.deleteMany({
          where: { student_id: d.student_id, academic_year_id: year.id, source: 'year_end' },
        });
      }
      const student = await tx.student.findUnique({ where: { id: d.student_id } });
      if (student) {
        // Only undo what we did: if someone has since moved the student again, leave their placement alone.
        const movedSince = snap.applied_class_id && student.class_id !== snap.applied_class_id;
        if (movedSince) warnings.push(`${student.student_number}: class was changed after the transition — placement left as is`);
        await tx.student.update({
          where: { id: student.id },
          data: {
            ...(!movedSince && snap.applied_class_id && { class_id: snap.prev_class_id, class_name: snap.prev_class_name, grade_level_name: snap.prev_grade_level_name }),
            is_active: snap.prev_is_active ?? true, updated_at: new Date(),
          },
        });
      }
      await tx.yearEndDecision.update({ where: { id: d.id }, data: { applied_at: null, applied_snapshot: null, updated_at: new Date() } });
      await audit(tx, req, {
        action: 'reversed', academic_year_id: year.id, class_id: cls.id, student_id: d.student_id, run_id: run.id,
        details: { reason: String(reason).trim(), restoredClass: snap.prev_class_name ?? null },
      });
      reverted += 1;
    }
    await tx.yearEndRun.update({
      where: { id: run.id },
      data: { status: 'reversed', reversed_at: new Date(), reversed_by_name: actor.name },
    });
    const classIds = new Set([cls.id, ...applied.map((d) => d.applied_snapshot?.applied_class_id).filter(Boolean)]);
    for (const id of classIds) {
      const enrolled = await tx.student.count({ where: { class_id: id, is_active: true } });
      await tx.class.update({ where: { id }, data: { enrolled } });
    }
    await audit(tx, req, { action: 'reversed', academic_year_id: year.id, class_id: cls.id, run_id: run.id, details: { reason: String(reason).trim(), reverted } });
  }, TX_OPTS);

  res.json({ reverted, warnings });
});

// ── Run status & audit trail ───────────────────────────────────────────────────

router.get('/run', adminOnly, async (req, res) => {
  const { year, cls } = await requireYearAndClass(req.db, req.query.yearId, req.query.classId);
  const run = await req.db.yearEndRun.findUnique({ where: { run_year_class: { academic_year_id: year.id, class_id: cls.id } } });
  res.json(run && {
    id: run.id, status: run.status, nextYearId: run.next_academic_year_id, confirmedAt: run.confirmed_at,
    confirmedBy: run.confirmed_by_name, reversedAt: run.reversed_at, reversedBy: run.reversed_by_name,
    note: run.note, totals: run.summary,
  });
});

router.get('/audit', adminOnly, async (req, res) => {
  const { yearId, classId, studentId } = req.query;
  const where = {};
  if (yearId) where.academic_year_id = yearId;
  if (classId) where.class_id = classId;
  if (studentId) where.student_id = studentId;
  const rows = await req.db.yearEndAudit.findMany({ where, orderBy: { created_at: 'desc' }, take: 300 });
  res.json(rows.map((r) => ({
    id: r.id, action: r.action, actor: r.actor_name, studentId: r.student_id, at: r.created_at, details: r.details,
  })));
});

module.exports = router;
