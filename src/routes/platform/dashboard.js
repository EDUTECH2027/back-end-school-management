const router = require('express').Router();
const platformDb = require('../../db/platform');
const { runWithTenant } = require('../../db/tenantContext');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');

const guard = [authenticatePlatform, authorizePlatform()];

function tenantCounts(schoolId) {
  try {
    return runWithTenant(schoolId, () => {
      const db = require('../../db/database');
      const students = db.prepare('SELECT COUNT(*) as c FROM students WHERE is_active=1').get().c;
      const teachers = db.prepare('SELECT COUNT(*) as c FROM teachers WHERE is_active=1').get().c;
      const parents = db.prepare('SELECT COUNT(*) as c FROM parents').get().c;
      return { students, teachers, parents };
    });
  } catch {
    return { students: 0, teachers: 0, parents: 0 };
  }
}

// GET /api/platform/dashboard
router.get('/', ...guard, (req, res) => {
  const schools = platformDb.prepare('SELECT * FROM schools').all();
  const plans = platformDb.prepare('SELECT * FROM subscription_plans').all();
  const planById = Object.fromEntries(plans.map(p => [p.id, p]));

  let totalStudents = 0, totalTeachers = 0, totalParents = 0, revenue = 0;
  const byPlan = {};

  for (const school of schools) {
    const counts = tenantCounts(school.id);
    totalStudents += counts.students;
    totalTeachers += counts.teachers;
    totalParents += counts.parents;

    const plan = planById[school.plan_id];
    if (plan && school.status === 'active') revenue += plan.price;

    const planName = plan ? plan.name : 'Unassigned';
    byPlan[planName] = (byPlan[planName] || 0) + 1;
  }

  const activeSchools = schools.filter(s => s.status === 'active').length;
  const inactiveSchools = schools.length - activeSchools;

  // Schools overview: active vs new schools per month, last 12 months
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en-US', { month: 'short' }) });
  }
  const overview = months.map(({ key, label }) => {
    const newThisMonth = schools.filter(s => (s.created_at || '').slice(0, 7) === key).length;
    const activeByMonthEnd = schools.filter(s => (s.created_at || '') <= `${key}-31` && s.status === 'active').length;
    return { month: label, active: activeByMonthEnd, new: newThisMonth };
  });

  const recentActivities = platformDb.prepare('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 8').all();

  res.json({
    totalSchools: schools.length,
    activeSchools,
    inactiveSchools,
    totalStudents,
    totalTeachers,
    totalParents,
    revenue,
    schoolsByPlan: Object.entries(byPlan).map(([name, count]) => ({ name, count })),
    schoolsOverview: overview,
    recentActivities,
  });
});

module.exports = router;
