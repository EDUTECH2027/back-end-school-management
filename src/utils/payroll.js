/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Single source of truth for the net-pay formula — previously duplicated
// between JS (payroll.js's calcNet) and a raw SQL SUM(...) expression in the
// /summary aggregate query.
function calcNet(r) {
  return (r.base_allowance + r.hourly_rate * r.hours_worked)
    - (r.absence_deduction * r.absences)
    - (r.late_deduction * r.late_coming)
    + r.bonus;
}

module.exports = { calcNet };
