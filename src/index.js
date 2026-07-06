require('dotenv').config();
const path      = require('path');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const bcrypt    = require('bcryptjs');
const { v4: uuid } = require('uuid');

const platformDb = require('./db/platform');
const { createPlatformSchema } = require('./db/platformSchema');
const { createSchema } = require('./db/schema');
const tenantContext = require('./db/tenantContext');
const errorHandler = require('./middleware/errorHandler');

// ── Bootstrap platform registry DB ─────────────────────────────────────────────
createPlatformSchema(platformDb);

// ── Bootstrap a first platform admin if none exists ────────────────────────────
function bootstrapPlatformAdmin() {
  const { n } = platformDb.prepare('SELECT COUNT(*) AS n FROM platform_admins').get();
  if (n > 0) return;

  const email = process.env.PLATFORM_ADMIN_EMAIL || 'superadmin@platform.local';
  const password = process.env.PLATFORM_ADMIN_PASSWORD || 'SuperAdmin@2025';
  platformDb.prepare(`
    INSERT INTO platform_admins (id, name, email, password_hash, role, initials, created_at, updated_at)
    VALUES (?, 'Super Admin', ?, ?, 'platform_owner', 'SA', datetime('now'), datetime('now'))
  `).run(uuid(), email, bcrypt.hashSync(password, 10));

  console.log(`[server] Bootstrapped platform owner account: ${email} / ${password}`);
}
bootstrapPlatformAdmin();

// ── Run pending tenant-schema migrations for every registered school on boot ───
for (const school of platformDb.prepare('SELECT id FROM schools').all()) {
  try {
    tenantContext.runWithTenant(school.id, () => createSchema(require('./db/database')));
  } catch (e) {
    console.error(`[server] Failed to migrate tenant ${school.id}:`, e.message);
  }
}

const authRouter         = require('./routes/auth');
const schoolRouter       = require('./routes/school');
const academicRouter     = require('./routes/academic');
const subjectsRouter     = require('./routes/subjects');
const teachersRouter     = require('./routes/teachers');
const classesRouter      = require('./routes/classes');
const studentsRouter     = require('./routes/students');
const parentsRouter      = require('./routes/parents');
const attendanceRouter   = require('./routes/attendance');
const timetableRouter    = require('./routes/timetable');
const marksRouter        = require('./routes/marks');
const reportCardsRouter  = require('./routes/reportCards');
const feesRouter         = require('./routes/fees');
const payrollRouter      = require('./routes/payroll');
const announcementsRouter = require('./routes/announcements');
const emailAlertsRouter  = require('./routes/emailAlerts');
const forumsRouter       = require('./routes/forums');
const dashboardRouter    = require('./routes/dashboard');
const usersRouter        = require('./routes/users');
const migrateRouter      = require('./routes/migrate');
const behaviorRouter     = require('./routes/behavior');
const withdrawalsRouter  = require('./routes/withdrawals');
const portalTeacherRouter = require('./routes/portal/teacher');
const portalStudentRouter = require('./routes/portal/student');
const portalParentRouter  = require('./routes/portal/parent');

// ── Platform (Super Admin) routes ───────────────────────────────────────────────
const platformDashboardRouter     = require('./routes/platform/dashboard');
const platformSchoolsRouter       = require('./routes/platform/schools');
const platformPlansRouter         = require('./routes/platform/plans');
const platformUsersRouter         = require('./routes/platform/users');
const platformLogsRouter          = require('./routes/platform/logs');
const platformAdminsRouter        = require('./routes/platform/admins');
const platformAnnouncementsRouter = require('./routes/platform/announcements');
const platformSettingsRouter      = require('./routes/platform/settings');
const platformBackupRouter        = require('./routes/platform/backup');
const platformReportsRouter       = require('./routes/platform/reports');
const platformFeaturesRouter      = require('./routes/platform/features');

// ── App ───────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: (origin, cb) => cb(null, true), // all origins allowed (desktop + dev)
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRouter);
app.use('/api/school',        schoolRouter);
app.use('/api/academic',      academicRouter);
app.use('/api/subjects',      subjectsRouter);
app.use('/api/teachers',      teachersRouter);
app.use('/api/classes',       classesRouter);
app.use('/api/students',      studentsRouter);
app.use('/api/parents',       parentsRouter);
app.use('/api/attendance',    attendanceRouter);
app.use('/api/timetable',     timetableRouter);
app.use('/api/marks',         marksRouter);
app.use('/api/report-cards',  reportCardsRouter);
app.use('/api/fees',          feesRouter);
app.use('/api/payroll',       payrollRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/email-alerts',  emailAlertsRouter);
app.use('/api/forums',        forumsRouter);
app.use('/api/dashboard',        dashboardRouter);
app.use('/api/users',            usersRouter);
app.use('/api/behavior',         behaviorRouter);
app.use('/api/withdrawals',      withdrawalsRouter);
app.use('/api/migrate',          migrateRouter);
app.use('/api/portal/teacher',   portalTeacherRouter);
app.use('/api/portal/student',   portalStudentRouter);
app.use('/api/portal/parent',    portalParentRouter);

// ── Platform (Super Admin) routes ───────────────────────────────────────────────
app.use('/api/platform/dashboard',     platformDashboardRouter);
app.use('/api/platform/schools',       platformSchoolsRouter);
app.use('/api/platform/plans',         platformPlansRouter);
app.use('/api/platform/users',         platformUsersRouter);
app.use('/api/platform/logs',          platformLogsRouter);
app.use('/api/platform/admins',        platformAdminsRouter);
app.use('/api/platform/announcements', platformAnnouncementsRouter);
app.use('/api/platform/settings',      platformSettingsRouter);
app.use('/api/platform/backup',        platformBackupRouter);
app.use('/api/platform/reports',       platformReportsRouter);
app.use('/api/platform/features',      platformFeaturesRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Desktop mode: serve built React frontend ──────────────────────────────────
if (process.env.FRONTEND_PATH) {
  const feDir = process.env.FRONTEND_PATH;
  app.use(express.static(feDir));
  app.get(/^(?!\/api)/, (_req, res) =>
    res.sendFile(path.join(feDir, 'index.html'))
  );
}

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`\n🚀  School Management API running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Docs:   see README for full endpoint list\n`);
  // Signal Electron main process that the server is ready
  if (process.send) process.send({ type: 'ready', port: Number(PORT) });
});

module.exports = app;
