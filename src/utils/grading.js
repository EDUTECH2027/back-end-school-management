/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Letter-grade bands on the 0–100 scale. Single source of truth: the marks route
// grades individual marks with it and the year-end module bands class averages with it.
const gradeFor = (score) => {
  if (score >= 90) return { grade: 'A+', remark: 'Excellent' };
  if (score >= 80) return { grade: 'A',  remark: 'Very Good' };
  if (score >= 70) return { grade: 'B',  remark: 'Good' };
  if (score >= 60) return { grade: 'C',  remark: 'Average' };
  if (score >= 50) return { grade: 'D',  remark: 'Below Average' };
  return { grade: 'F', remark: 'Fail' };
};

const GRADE_ORDER = ['A+', 'A', 'B', 'C', 'D', 'F'];

module.exports = { gradeFor, GRADE_ORDER };
