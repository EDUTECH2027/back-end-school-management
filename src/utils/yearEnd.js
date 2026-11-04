/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Pure (database-free) logic for the end-of-year module: master-sheet maths, ranking, status
// proposals and transition planning. Everything numeric goes through reportCardMath so the
// averages here are exactly the ones report cards already produce.
const { weightedSequenceAverages, annualAverage } = require('./reportCardMath');
const { gradeFor, GRADE_ORDER } = require('./grading');

const TERM_NAMES = ['first', 'second', 'third'];
const round1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

const STUDENT_NAME = (s) => [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');

// Standard competition ranking (1, 1, 3, 4…): equal values share a position.
// Items whose value is null/undefined are left unranked.
function competitionRanks(items, valueOf) {
  const ranked = items
    .map((it) => ({ it, v: valueOf(it) }))
    .filter((x) => x.v != null)
    .sort((a, b) => b.v - a.v);
  const out = new Map();
  let rank = 1;
  ranked.forEach((x, i) => {
    if (i > 0 && ranked[i - 1].v !== x.v) rank = i + 1;
    out.set(x.it, rank);
  });
  return out;
}

/**
 * Builds the consolidated results of a class for one academic year.
 *
 * @param {object}   p
 * @param {Array}    p.students   [{ id, first_name, middle_name?, last_name, student_number }]
 * @param {Array}    p.terms      the year's terms [{ id, name: 'first'|'second'|'third' }]
 * @param {Array}    p.marks      marks of this class in those terms [{ student_id, subject_id, subject_name, term_id, ca_score, exam_score, total_score }]
 * @param {Object}   p.coefficientById  subject id → coefficient (defaults to 1)
 * @param {string?}  p.termId     restrict to one term; omit for the annual view
 */
function buildSheet({ students, terms, marks, coefficientById = {}, termId = null }) {
  const coefOf = (id) => coefficientById[id] ?? 1;
  const orderedTerms = TERM_NAMES.map((n) => terms.find((t) => t.name === n)).filter(Boolean);
  const scopedTerms = termId ? orderedTerms.filter((t) => t.id === termId) : orderedTerms;

  // marksBy[termId][studentId][subjectId]
  const marksBy = {};
  const subjectNames = {};
  const subjectsByTerm = {};
  for (const m of marks) {
    ((marksBy[m.term_id] ||= {})[m.student_id] ||= {})[m.subject_id] = m;
    subjectNames[m.subject_id] ||= m.subject_name || m.subject_id;
    (subjectsByTerm[m.term_id] ||= new Set()).add(m.subject_id);
  }

  // Per term, the same canonical subject set report-card generation uses, so a missing mark
  // counts as 0 for everyone alike while its coefficient still stays in the denominator.
  const termData = {};
  for (const t of orderedTerms) {
    const subjectIds = [...(subjectsByTerm[t.id] || [])];
    const perStudent = {};
    for (const s of students) {
      const own = marksBy[t.id]?.[s.id];
      if (!own) { perStudent[s.id] = null; continue; } // never graded this term
      const rows = subjectIds.map((sid) => ({
        ca_score: own[sid]?.ca_score || 0,
        exam_score: own[sid]?.exam_score || 0,
        coefficient: coefOf(sid),
      }));
      const { termAverage } = weightedSequenceAverages(rows);
      const totalCoefficient = rows.reduce((a, r) => a + r.coefficient, 0);
      const weightedTotal = rows.reduce((a, r) => a + ((r.ca_score + r.exam_score) / 2) * r.coefficient, 0);
      const missing = subjectIds.filter((sid) => !own[sid]);
      perStudent[s.id] = { termAverage, totalCoefficient, weightedTotal, missing };
    }
    termData[t.name] = { termId: t.id, subjectIds, perStudent };
  }

  // Subject columns: union over the scoped terms.
  const subjectIdSet = new Set();
  scopedTerms.forEach((t) => termData[t.name].subjectIds.forEach((id) => subjectIdSet.add(id)));
  const subjects = [...subjectIdSet]
    .map((id) => ({ id, name: subjectNames[id], coefficient: coefOf(id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const rows = students.map((s) => {
    const termAverages = {};
    for (const n of TERM_NAMES) termAverages[n] = termData[n]?.perStudent[s.id]?.termAverage ?? null;

    // Subject mark shown: the stored total of the term, or the mean over the terms graded in the annual view.
    const subjectMarks = {};
    for (const sub of subjects) {
      const vals = scopedTerms
        .map((t) => marksBy[t.id]?.[s.id]?.[sub.id])
        .filter(Boolean)
        .map((m) => m.total_score);
      subjectMarks[sub.id] = vals.length ? round1(mean(vals)) : null;
    }

    const scopedData = scopedTerms.map((t) => termData[t.name].perStudent[s.id]).filter(Boolean);
    const issues = [];
    scopedTerms.forEach((t) => {
      const d = termData[t.name].perStudent[s.id];
      if (!d) issues.push(`No marks for the ${t.name} term`);
      else if (d.missing.length) issues.push(`${d.missing.length} subject(s) missing in the ${t.name} term`);
    });

    if (!termId && orderedTerms.length < TERM_NAMES.length) {
      issues.push(`Academic year has only ${orderedTerms.length} of ${TERM_NAMES.length} terms configured`);
    }

    let average = null;
    let provisional = false;
    if (termId) {
      average = scopedData[0]?.termAverage ?? null;
    } else {
      average = annualAverage(termAverages);
      if (average == null && scopedData.length) {
        average = round1(mean(scopedData.map((d) => d.termAverage)));
        provisional = true;
      }
    }

    const weightedTotal = scopedData.length ? round1(mean(scopedData.map((d) => d.weightedTotal))) : null;
    const totalCoefficient = scopedData.length ? round1(mean(scopedData.map((d) => d.totalCoefficient))) : null;
    const termsFound = TERM_NAMES.filter((n) => termAverages[n] != null).length;

    return {
      studentId: s.id,
      name: STUDENT_NAME(s),
      matricule: s.student_number,
      marks: subjectMarks,
      termAverages,
      termsFound,
      average,
      provisional,
      weightedTotal,
      totalCoefficient,
      issues,
      complete: issues.length === 0 && (termId ? true : termsFound === TERM_NAMES.length),
    };
  });

  // A provisional (partial-year) average never competes with official ones: once anyone has a
  // full-year average, only those students are ranked. Before that (year still in progress),
  // the provisional averages are ranked among themselves.
  const anyOfficial = rows.some((r) => r.average != null && !r.provisional);
  const ranks = competitionRanks(rows, (r) => (anyOfficial && r.provisional ? null : r.average));
  rows.forEach((r) => { r.rank = ranks.get(r) ?? null; });

  return { subjects, rows, termsInScope: scopedTerms.map((t) => t.name) };
}

/** Top performers per subject. `limit` counts positions, so ties at the cut-off are all included. */
function subjectLeaders(sheet, limit = 3) {
  return sheet.subjects.map((sub) => {
    const entries = sheet.rows.filter((r) => r.marks[sub.id] != null);
    const ranks = competitionRanks(entries, (r) => r.marks[sub.id]);
    const top = entries
      .filter((r) => ranks.get(r) <= limit)
      .sort((a, b) => ranks.get(a) - ranks.get(b) || a.name.localeCompare(b.name))
      .map((r) => ({ studentId: r.studentId, name: r.name, matricule: r.matricule, mark: r.marks[sub.id], rank: ranks.get(r) }));
    const values = entries.map((r) => r.marks[sub.id]);
    return {
      subjectId: sub.id,
      subjectName: sub.name,
      coefficient: sub.coefficient,
      best: top.filter((t) => t.rank === 1),
      top,
      average: values.length ? round1(mean(values)) : null,
      highest: values.length ? Math.max(...values) : null,
      lowest: values.length ? Math.min(...values) : null,
      graded: values.length,
    };
  });
}

function classStats(sheet, decisions = []) {
  const withAvg = sheet.rows.filter((r) => r.average != null && r.rank != null); // same population as the ranking
  const avgs = withAvg.map((r) => r.average);
  const distribution = Object.fromEntries(GRADE_ORDER.map((g) => [g, 0]));
  avgs.forEach((a) => { distribution[gradeFor(a).grade] += 1; });

  const total = sheet.rows.length;
  const count = (status) => decisions.filter((d) => d.status === status).length;
  const pct = (n) => (total ? round1((n / total) * 100) : 0);
  const promoted = count('promoted');
  const repeating = count('repeating');
  const pending = total - decisions.filter((d) => d.status !== 'pending_review').length;

  return {
    studentCount: total,
    gradedCount: withAvg.length,
    classAverage: avgs.length ? round1(mean(avgs)) : null,
    highestAverage: avgs.length ? Math.max(...avgs) : null,
    lowestAverage: avgs.length ? Math.min(...avgs) : null,
    distribution,
    promoted, promotedPct: pct(promoted),
    repeating, repeatingPct: pct(repeating),
    pendingReview: pending, pendingReviewPct: pct(pending),
    withdrawn: count('withdrawn'), transferred: count('transferred'), graduated: count('graduated'),
  };
}

/** What the rules suggest. Only a student with complete results gets an automatic proposal. */
function proposeStatus({ average, complete, incompleteReason }, passAverage) {
  if (!complete || average == null) {
    return { status: 'pending_review', reason: incompleteReason || 'Incomplete results — needs manual review' };
  }
  return average >= passAverage
    ? { status: 'promoted', reason: null }
    : { status: 'repeating', reason: null };
}

// ── Transition planning ────────────────────────────────────────────────────────

const EXIT_STATUSES = new Set(['withdrawn', 'transferred', 'graduated']);

const stripLevel = (className, levelName) =>
  String(className || '').replace(levelName || '', '').trim().toLowerCase();

/**
 * Where do promoted students of `cls` go?
 * Order: explicit per-student override → class flagged final → class's configured next class →
 * inferred from grade-level order (single class in the next level, else same section suffix).
 * @returns {{kind:'class', classId:string} | {kind:'final'} | {kind:'unresolved', reason:string}}
 */
function resolveNextClass({ cls, classes, gradeLevels, studentTargetId = null }) {
  const byId = new Map(classes.map((c) => [c.id, c]));
  if (studentTargetId) {
    return byId.has(studentTargetId)
      ? { kind: 'class', classId: studentTargetId }
      : { kind: 'unresolved', reason: 'The chosen destination class no longer exists' };
  }
  if (cls.is_final_class) return { kind: 'final' };
  if (cls.next_class_id) {
    return byId.has(cls.next_class_id)
      ? { kind: 'class', classId: cls.next_class_id }
      : { kind: 'unresolved', reason: 'The configured next class no longer exists' };
  }

  const levels = [...gradeLevels].sort((a, b) => a.sort_order - b.sort_order);
  const idx = levels.findIndex((l) => l.id === cls.grade_level_id);
  if (idx === -1) return { kind: 'unresolved', reason: 'No next class configured and the class has no grade level' };
  const next = levels[idx + 1];
  if (!next) return { kind: 'final' };

  const candidates = classes.filter((c) => c.grade_level_id === next.id);
  if (candidates.length === 0) return { kind: 'unresolved', reason: `No class exists in the next level (${next.name})` };
  if (candidates.length === 1) return { kind: 'class', classId: candidates[0].id };
  const suffix = stripLevel(cls.name, levels[idx].name);
  const same = candidates.filter((c) => stripLevel(c.name, next.name) === suffix);
  return same.length === 1
    ? { kind: 'class', classId: same[0].id }
    : { kind: 'unresolved', reason: `Several classes in ${next.name} — choose the destination` };
}

/**
 * Turns finalized decisions into per-student actions. Pure: callers pass in what they loaded.
 *
 * actions: promote | repeat | graduate | hold | exit | skip_pending | already_applied
 * A non-empty `blockers` list means the item cannot be applied until fixed.
 *
 * @param {object} p
 * @param {Array}  p.decisions            YearEndDecision rows (+ student)
 * @param {object} p.cls                  source class
 * @param {Array}  p.classes              all classes
 * @param {Array}  p.gradeLevels
 * @param {string} p.finalClassOutcome    'graduate' | 'hold'
 * @param {Map}    p.nextYearEnrollments  studentId → { id, class_id } already present in the target year
 */
function planTransition({ decisions, cls, classes, gradeLevels, finalClassOutcome, nextYearEnrollments = new Map() }) {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const plan = decisions.map((d) => {
    const item = {
      decisionId: d.id, studentId: d.student_id, status: d.status,
      action: null, targetClassId: null, targetClassName: null, blockers: [], warnings: [],
    };

    if (d.applied_at) { item.action = 'already_applied'; return item; }
    if (d.status === 'pending_review' || !d.validated_at) { item.action = 'skip_pending'; return item; }

    const existing = nextYearEnrollments.get(d.student_id);

    if (EXIT_STATUSES.has(d.status) ) { item.action = 'exit'; return item; }

    if (d.status === 'repeating') {
      item.action = 'repeat';
      item.targetClassId = cls.id;
    } else { // promoted
      const next = resolveNextClass({ cls, classes, gradeLevels, studentTargetId: d.target_class_id });
      if (next.kind === 'class') {
        item.action = 'promote';
        item.targetClassId = next.classId;
      } else if (next.kind === 'final') {
        item.action = finalClassOutcome === 'hold' ? 'hold' : 'graduate';
        if (item.action === 'hold') item.warnings.push('Last class — held for manual placement');
      } else {
        item.action = 'promote';
        item.blockers.push(next.reason);
      }
    }

    if (item.targetClassId) {
      item.targetClassName = classById.get(item.targetClassId)?.name ?? null;
      if (existing && existing.class_id !== item.targetClassId) {
        item.blockers.push('Already enrolled in a different class for the new academic year');
      }
    }
    return item;
  });

  // Capacity is advisory: warn on the destination class, never block.
  const incoming = new Map();
  plan.filter((p) => p.targetClassId && p.blockers.length === 0).forEach((p) => {
    incoming.set(p.targetClassId, (incoming.get(p.targetClassId) || 0) + 1);
  });
  incoming.forEach((n, classId) => {
    const c = classById.get(classId);
    if (c && c.capacity && n > c.capacity) {
      plan.filter((p) => p.targetClassId === classId).forEach((p) => p.warnings.push(`Destination ${c.name} would exceed its capacity (${c.capacity})`));
    }
  });
  return plan;
}

/** Counts of each action, for previews and run summaries. */
function summarizePlan(plan) {
  const s = { promote: 0, repeat: 0, graduate: 0, hold: 0, exit: 0, skip_pending: 0, already_applied: 0, blocked: 0 };
  plan.forEach((p) => { s[p.action] += 1; if (p.blockers.length) s.blocked += 1; });
  return s;
}

/**
 * Executes a plan inside a caller-provided transaction client. Idempotent: applied decisions are
 * skipped, and enrollments are guarded by the (student, academic year) unique key.
 * Throws on any conflict so the surrounding transaction rolls everything back.
 */
async function applyPlan(tx, { plan, sourceYearId, nextYearId, cls, classes, actor, runId, now = new Date(), newId }) {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const touchedClasses = new Set([cls.id]);
  const applied = { promoted: 0, repeated: 0, graduated: 0, exited: 0, held: 0, skippedPending: 0, alreadyApplied: 0 };

  for (const item of plan) {
    if (item.action === 'already_applied') { applied.alreadyApplied += 1; continue; }
    if (item.action === 'skip_pending') { applied.skippedPending += 1; continue; }
    if (item.action === 'hold') { applied.held += 1; continue; }
    if (item.blockers.length) throw new Error(`Cannot apply ${item.studentId}: ${item.blockers[0]}`);

    // Re-read inside the transaction: a concurrent confirm or an un-validation may have changed it.
    const fresh = await tx.yearEndDecision.findUnique({ where: { id: item.decisionId } });
    if (!fresh) throw new Error(`Decision ${item.decisionId} no longer exists`);
    if (fresh.applied_at) { applied.alreadyApplied += 1; continue; }
    if (fresh.status !== item.status || !fresh.validated_at) {
      throw new Error(`Decision for ${item.studentId} changed while confirming — review and retry`);
    }

    const student = await tx.student.findUnique({ where: { id: item.studentId } });
    if (!student) throw new Error(`Student ${item.studentId} no longer exists`);

    const snapshot = {
      prev_class_id: student.class_id, prev_class_name: student.class_name,
      prev_grade_level_name: student.grade_level_name, prev_is_active: student.is_active,
      source_enrollment_created: false, next_enrollment_id: null, next_enrollment_created: false,
      applied_class_id: null, action: item.action,
    };

    // History: make sure the closing year's enrollment is on record.
    const sourceEnr = await tx.classEnrollment.findUnique({
      where: { enrollment_student_year: { student_id: item.studentId, academic_year_id: sourceYearId } },
    });
    if (!sourceEnr) {
      await tx.classEnrollment.create({
        data: { id: newId(), student_id: item.studentId, class_id: cls.id, class_name: cls.name, academic_year_id: sourceYearId, source: 'year_end', created_by: actor.id },
      });
      snapshot.source_enrollment_created = true;
    }

    if (item.targetClassId) {
      const target = classById.get(item.targetClassId);
      if (!target) throw new Error(`Destination class missing for ${item.studentId}`);
      const existing = await tx.classEnrollment.findUnique({
        where: { enrollment_student_year: { student_id: item.studentId, academic_year_id: nextYearId } },
      });
      if (existing && existing.class_id !== target.id) {
        throw new Error(`Student ${item.studentId} is already enrolled in another class for the new academic year`);
      }
      if (existing) {
        snapshot.next_enrollment_id = existing.id;
      } else {
        const created = await tx.classEnrollment.create({
          data: { id: newId(), student_id: item.studentId, class_id: target.id, class_name: target.name, academic_year_id: nextYearId, source: 'year_end', created_by: actor.id },
        });
        snapshot.next_enrollment_id = created.id;
        snapshot.next_enrollment_created = true;
      }
      // Profile, guardian and student number are untouched — only the "current class" pointer moves.
      await tx.student.update({
        where: { id: item.studentId },
        data: { class_id: target.id, class_name: target.name, grade_level_name: target.grade_level_name ?? student.grade_level_name, updated_at: now },
      });
      snapshot.applied_class_id = target.id;
      touchedClasses.add(target.id);
      applied[item.action === 'promote' ? 'promoted' : 'repeated'] += 1;
    } else {
      // graduate / withdrawn / transferred: leaves the active roll, history is kept.
      await tx.student.update({ where: { id: item.studentId }, data: { is_active: false, updated_at: now } });
      applied[item.action === 'graduate' ? 'graduated' : 'exited'] += 1;
    }

    await tx.yearEndDecision.update({
      where: { id: item.decisionId },
      data: { applied_at: now, applied_snapshot: snapshot, updated_at: now },
    });
    await tx.yearEndAudit.create({
      data: {
        id: newId(), academic_year_id: sourceYearId, class_id: cls.id, student_id: item.studentId, run_id: runId,
        action: 'transitioned', actor_id: actor.id, actor_name: actor.name,
        details: { action: item.action, from: snapshot.prev_class_name, to: item.targetClassName, nextYearId },
      },
    });
  }

  // The dashboards read classes.enrolled — refresh the headcount of every class we touched.
  for (const classId of touchedClasses) {
    const enrolled = await tx.student.count({ where: { class_id: classId, is_active: true } });
    await tx.class.update({ where: { id: classId }, data: { enrolled } });
  }
  return applied;
}

module.exports = {
  TERM_NAMES, competitionRanks, buildSheet, subjectLeaders, classStats, proposeStatus,
  resolveNextClass, planTransition, summarizePlan, applyPlan, EXIT_STATUSES,
};
