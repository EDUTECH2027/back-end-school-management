// Replaces the `CASE WHEN day='monday' THEN 1...` SQL ordering idiom that was
// duplicated across timetable.js, portal/student.js, and portal/teacher.js.
const DAY_ORDER = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5 };

function sortByDay(rows, dayField = 'day', ...tieBreakFields) {
  return [...rows].sort((a, b) => {
    const d = (DAY_ORDER[a[dayField]] || 6) - (DAY_ORDER[b[dayField]] || 6);
    if (d !== 0) return d;
    for (const f of tieBreakFields) {
      const av = a[f], bv = b[f];
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
}

module.exports = { DAY_ORDER, sortByDay };
