const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const totalStudents = db.prepare('SELECT COUNT(*) as c FROM students WHERE is_active=1').get().c;
  const totalTeachers = db.prepare('SELECT COUNT(*) as c FROM teachers WHERE is_active=1').get().c;
  const totalClasses  = db.prepare('SELECT COUNT(*) as c FROM classes').get().c;

  const todayAtt = db.prepare(`
    SELECT
      SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) as present,
      SUM(CASE WHEN status='absent'  THEN 1 ELSE 0 END) as absent
    FROM attendance_records WHERE date=?
  `).get(today);

  const presentToday = todayAtt?.present || 0;
  const absentToday  = todayAtt?.absent  || 0;
  const attendanceRate = totalStudents > 0
    ? Math.round((presentToday / totalStudents) * 1000) / 10
    : 0;

  const fees = db.prepare(`
    SELECT SUM(amount_paid) as collected, SUM(balance) as pending, SUM(amount_due) as total
    FROM fee_records
  `).get();

  const recentAnnouncements = db.prepare(
    "SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5"
  ).all();

  const classSizes = db.prepare(`
    SELECT c.name, c.enrolled, c.capacity
    FROM classes c ORDER BY c.name
  `).all();

  const feesByStatus = db.prepare(`
    SELECT status, COUNT(*) as count, SUM(balance) as total_balance
    FROM fee_records GROUP BY status
  `).all();

  res.json({
    totalStudents,
    totalTeachers,
    totalClasses,
    presentToday,
    absentToday,
    attendanceRate,
    feesCollected: fees?.collected || 0,
    feesPending:   fees?.pending   || 0,
    feesTotal:     fees?.total     || 0,
    recentAnnouncements,
    classSizes,
    feesByStatus,
  });
});

module.exports = router;
