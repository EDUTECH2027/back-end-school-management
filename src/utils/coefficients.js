/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Subject coefficients can differ per class (Maths ×4 in Form 1, ×5 in Form 5).
// subjects.coefficient is the DEFAULT; subject_coefficient_overrides refine it.
// Precedence: class override → grade-level override → subject default.
// With no overrides stored, every result is identical to the pre-override behaviour.

/** Pure: pick the effective coefficient of each subject for one class. */
function resolveCoefficients({ subjects, classId = null, gradeLevelId = null, overrides = [] }) {
  const byClass = new Map();
  const byGrade = new Map();
  for (const o of overrides) {
    if (o.class_id && o.class_id === classId) byClass.set(o.subject_id, o.coefficient);
    else if (o.grade_level_id && o.grade_level_id === gradeLevelId) byGrade.set(o.subject_id, o.coefficient);
  }
  const out = {};
  for (const s of subjects) out[s.id] = byClass.get(s.id) ?? byGrade.get(s.id) ?? s.coefficient;
  return out;
}

/**
 * subject id → effective coefficient for a class, identified by id or (for cards that only
 * remember the class as text) by its unique name. Unknown/absent class → plain defaults.
 */
async function coefficientsFor(db, { classId = null, className = null, subjectIds = null } = {}) {
  const subjects = await db.subject.findMany(subjectIds ? { where: { id: { in: subjectIds } } } : undefined);
  if (subjects.length === 0) return {};

  let cls = null;
  if (classId) cls = await db.class.findUnique({ where: { id: classId }, select: { id: true, grade_level_id: true } });
  else if (className) cls = await db.class.findUnique({ where: { name: className }, select: { id: true, grade_level_id: true } });
  if (!cls) return resolveCoefficients({ subjects });

  const scope = [{ class_id: cls.id }];
  if (cls.grade_level_id) scope.push({ grade_level_id: cls.grade_level_id });
  const overrides = await db.subjectCoefficientOverride.findMany({
    where: { subject_id: { in: subjects.map((s) => s.id) }, OR: scope },
  });
  return resolveCoefficients({ subjects, classId: cls.id, gradeLevelId: cls.grade_level_id, overrides });
}

module.exports = { resolveCoefficients, coefficientsFor };
