const router = require('express').Router();
const authenticate = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const [totalStudents, totalTeachers, totalClasses, presentToday, absentToday, fees, recentAnnouncements, classSizes, feesByStatus] = await Promise.all([
    req.db.student.count({ where: { is_active: true } }),
    req.db.teacher.count({ where: { is_active: true } }),
    req.db.class.count(),
    req.db.attendanceRecord.count({ where: { date: today, status: 'present' } }),
    req.db.attendanceRecord.count({ where: { date: today, status: 'absent' } }),
    req.db.feeRecord.aggregate({ _sum: { amount_paid: true, balance: true, amount_due: true } }),
    req.db.announcement.findMany({ orderBy: { created_at: 'desc' }, take: 5 }),
    req.db.class.findMany({ select: { name: true, enrolled: true, capacity: true }, orderBy: { name: 'asc' } }),
    req.db.feeRecord.groupBy({ by: ['status'], _count: { _all: true }, _sum: { balance: true } }),
  ]);

  const attendanceRate = totalStudents > 0
    ? Math.round((presentToday / totalStudents) * 1000) / 10
    : 0;

  res.json({
    totalStudents,
    totalTeachers,
    totalClasses,
    presentToday,
    absentToday,
    attendanceRate,
    feesCollected: fees._sum.amount_paid || 0,
    feesPending: fees._sum.balance || 0,
    feesTotal: fees._sum.amount_due || 0,
    recentAnnouncements,
    classSizes,
    feesByStatus: feesByStatus.map(r => ({ status: r.status, count: r._count._all, total_balance: r._sum.balance })),
  });
});

module.exports = router;
