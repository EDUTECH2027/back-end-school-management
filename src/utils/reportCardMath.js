/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Single source of truth for the coefficient-weighted average formulas, shared
// by the report-card generation route and every portal "annual average" read.
//
// Sequence Average = Σ(subject mark × coefficient) / Σ(coefficient)
// Term Average      = (Sequence 1 Average + Sequence 2 Average) / 2
// Final Average     = mean of the three Term Averages (only once all 3 exist)

const round1 = (n) => Math.round(n * 10) / 10;

// rows: one entry per subject in the canonical subject list, each
// { ca_score, exam_score, coefficient }. A subject the student has no mark
// for should still be included with score 0 (its coefficient still counts
// toward the denominator) so the average stays fair across students.
function weightedSequenceAverages(rows) {
  const totalCoefficient = rows.reduce((sum, r) => sum + r.coefficient, 0);
  if (totalCoefficient <= 0) return { sequence1Average: 0, sequence2Average: 0, termAverage: 0 };

  const sequence1Average = rows.reduce((sum, r) => sum + r.ca_score * r.coefficient, 0) / totalCoefficient;
  const sequence2Average = rows.reduce((sum, r) => sum + r.exam_score * r.coefficient, 0) / totalCoefficient;
  const termAverage = (sequence1Average + sequence2Average) / 2;

  return {
    sequence1Average: round1(sequence1Average),
    sequence2Average: round1(sequence2Average),
    termAverage: round1(termAverage),
  };
}

// termPercentages: { first?, second?, third? } — whichever term averages were
// found for the student's academic year. Returns null (not a partial mean)
// unless all three terms are present.
function annualAverage(termPercentages) {
  const names = ['first', 'second', 'third'];
  const found = names.filter((n) => termPercentages[n] != null);
  if (found.length < names.length) return null;
  const sum = found.reduce((s, n) => s + termPercentages[n], 0);
  return round1(sum / names.length);
}

// Looks up the student's report card for each term of the given academic year
// and folds them into the Final Average. Shared by the admin annual-summary
// endpoint and the student/parent portal equivalents.
async function getAnnualSummary(db, { studentId, academicYearId }) {
  const terms = await db.term.findMany({ where: { academic_year_id: academicYearId } });
  const cards = terms.length
    ? await db.reportCard.findMany({ where: { student_id: studentId, term_id: { in: terms.map((t) => t.id) } } })
    : [];

  const byTermName = {};
  cards.forEach((c) => { byTermName[c.term_name] = c.percentage; });

  return {
    terms: { first: byTermName.first ?? null, second: byTermName.second ?? null, third: byTermName.third ?? null },
    termsFound: Object.values(byTermName).filter((v) => v != null).length,
    finalAverage: annualAverage(byTermName),
  };
}

module.exports = { weightedSequenceAverages, annualAverage, getAnnualSummary };
