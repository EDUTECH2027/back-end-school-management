const router = require('express').Router();
const platformClient = require('../../db/platformClient');
const tenantPool = require('../../db/tenantPool');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');

const guard = [authenticatePlatform, authorizePlatform()];

async function tenantCounts(schoolId) {
  try {
    const tenantDb = tenantPool.getOrOpen(schoolId);
    const [students, teachers, parents] = await Promise.all([
      tenantDb.student.count({ where: { is_active: true } }),
      tenantDb.teacher.count({ where: { is_active: true } }),
      tenantDb.parent.count(),
    ]);
    return { students, teachers, parents };
  } catch {
    return { students: 0, teachers: 0, parents: 0 };
  }
}

// GET /api/platform/dashboard
router.get('/', ...guard, async (req, res) => {
  const [schools, plans] = await Promise.all([
    platformClient.school.findMany(),
    platformClient.subscriptionPlan.findMany(),
  ]);
  const planById = Object.fromEntries(plans.map(p => [p.id, p]));

  let totalStudents = 0, totalTeachers = 0, totalParents = 0, revenue = 0;
  const byPlan = {};

  // Same per-school sequential-fan-out shape as the original — schema-per-tenant
  // means there's no free cross-tenant aggregate query the way one shared table
  // would allow, so this isn't optimized in this pass.
  for (const school of schools) {
    const counts = await tenantCounts(school.id);
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
  const createdAtStr = s => (s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at || '')).slice(0, 10);
  const overview = months.map(({ key, label }) => {
    const newThisMonth = schools.filter(s => createdAtStr(s).slice(0, 7) === key).length;
    const activeByMonthEnd = schools.filter(s => createdAtStr(s) <= `${key}-31` && s.status === 'active').length;
    return { month: label, active: activeByMonthEnd, new: newThisMonth };
  });

  const recentActivities = await platformClient.systemLog.findMany({ orderBy: { created_at: 'desc' }, take: 8 });

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
