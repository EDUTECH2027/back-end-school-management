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
