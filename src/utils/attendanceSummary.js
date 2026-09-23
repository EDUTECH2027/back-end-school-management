// Single source of truth for "how did this teacher's attendance look this
// month" — read by both Payroll and the admin reporting view, so neither one
// stores its own copy of what TeacherAttendance already knows.

/**
 * @returns {Promise<{
 *   daysPresent: number, daysOnTime: number, daysLate: number, absences: number,
 *   lateEntries: { date: string, scan_time: Date|null }[]
 * }>}
 */
async function getMonthlyAttendance(db, teacherId, month) {
  const rows = await db.teacherAttendance.findMany({
    where: { teacher_id: teacherId, date: { startsWith: month } },
    orderBy: { date: 'asc' },
  });

  const onTime = rows.filter(r => r.status === 'present');
  const late = rows.filter(r => r.status === 'late');
  const absent = rows.filter(r => r.status === 'absent');

  return {
    daysPresent: onTime.length + late.length,
    daysOnTime: onTime.length,
    daysLate: late.length,
    absences: absent.length,
    lateEntries: late.map(r => ({ date: r.date, scan_time: r.scan_time })),
  };
}

module.exports = { getMonthlyAttendance };
