/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
require('dotenv').config();
require('express-async-errors');
const path      = require('path');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const bcrypt    = require('bcryptjs');
const { v4: uuid } = require('uuid');

// Validates security-critical configuration and throws on a weak/missing secret.
// Required first so a misconfigured deployment fails fast.
const env = require('./config/env');
const { corsOptions } = require('./config/cors');
const { apiLimiter } = require('./middleware/rateLimit');

const platformClient = require('./db/platformClient');
const { provisionTenantSchema } = require('./db/provisionTenant');
const errorHandler = require('./middleware/errorHandler');
const licenseGate = require('./license/middleware');
const licenseState = require('./license/state');
const licensePhoneHome = require('./license/phoneHome');

// Neon (and similar serverless Postgres) suspends its compute after idling and
// can take a few seconds to wake on the next connection — long enough that the
// very first query on boot occasionally times out even though the database is
// fine. Retry with backoff instead of crashing the whole process over it.
async function waitForDatabase(attempts = 5, baseDelayMs = 1500) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await platformClient.$queryRaw`SELECT 1`;
      return;
    } catch (e) {
      if (i === attempts) throw e;
      const delay = baseDelayMs * 2 ** (i - 1);
      console.warn(`[server] Database not reachable yet (attempt ${i}/${attempts}): ${e.message.split('\n')[0]} — retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function bootstrap() {
  await waitForDatabase();

  // ── License gate (on-prem builds only) ────────────────────────────────────
  if (env.LICENSE_REQUIRED) {
    const status = licenseState.getStatus();
    if (!status.valid && !status.inGrace) {
      console.error(`\n[license] Refusing to start — license ${status.reason}. Contact your vendor.\n`);
      process.exit(1);
    }
    if (status.inGrace) {
      console.warn(`[license] WARNING: running in grace period (${status.reason}). Renew before it lapses.`);
    } else {
      console.log(`[license] OK (edition: ${status.edition || 'on_prem'}${status.expiresAt ? `, expires ${status.expiresAt}` : ''}).`);
    }
    licensePhoneHome.start(async () => {
      const schools = await platformClient.school.count().catch(() => null);
      return { schools };
    });
  }

  // ── Bootstrap a first platform admin if none exists ────────────────────────
  const platformAdminCount = await platformClient.platformAdmin.count();
  if (platformAdminCount === 0) {
    const email = process.env.PLATFORM_ADMIN_EMAIL || 'superadmin@platform.local';
    const password = process.env.PLATFORM_ADMIN_PASSWORD || 'SuperAdmin@2025';
    await platformClient.platformAdmin.create({
      data: { id: uuid(), name: 'Super Admin', email, password_hash: bcrypt.hashSync(password, 10), role: 'platform_owner', initials: 'SA' },
    });
    console.log(`[server] Bootstrapped platform owner account: ${email} / ${password}`);
  }

  // ── Bring every registered school's tenant schema up to date on boot ───────
  const schools = await platformClient.school.findMany({ select: { id: true } });
  for (const school of schools) {
    try {
      await provisionTenantSchema(school.id);
    } catch (e) {
      console.error(`[server] Failed to migrate tenant ${school.id}:`, e.message);
    }
  }
}

const authRouter         = require('./routes/auth');
const auth2faRouter      = require('./routes/auth2fa');
const licenseRouter      = require('./routes/license');
const schoolRouter       = require('./routes/school');
const academicRouter     = require('./routes/academic');
const subjectsRouter     = require('./routes/subjects');
const teachersRouter     = require('./routes/teachers');
const classesRouter      = require('./routes/classes');
const studentsRouter     = require('./routes/students');
const parentsRouter      = require('./routes/parents');
const attendanceRouter   = require('./routes/attendance');
const attendanceQrRouter = require('./routes/attendanceQr');
const timetableRouter    = require('./routes/timetable');
const marksRouter        = require('./routes/marks');
const marksSettingsRouter = require('./routes/marksSettings');
const reportCardsRouter  = require('./routes/reportCards');
const reportCardTemplateRouter = require('./routes/reportCardTemplate');
const certificatesRouter = require('./routes/certificates');
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
const platformLicensesRouter      = require('./routes/platform/licenses');

// ── App ───────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;

// Needed for correct client IPs (rate limiting, audit) behind a proxy/load
// balancer. Set TRUST_PROXY=1 in such deployments; leave unset for direct/local.
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(require('./utils/forumUploads').UPLOADS_ROOT));

// Broad rate limit across the whole API; the auth endpoints add a tighter one.
// ─── SECURITY DISABLED (temporary) — uncomment to re-enable API rate limiting ───
// app.use('/api', apiLimiter);

// Blocks the API on a hard license failure (no-op unless LICENSE_REQUIRED=true).
app.use(licenseGate);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/license',       licenseRouter);
app.use('/api/auth/2fa',      auth2faRouter);
app.use('/api/auth',          authRouter);
app.use('/api/school',        schoolRouter);
app.use('/api/academic',      academicRouter);
app.use('/api/subjects',      subjectsRouter);
app.use('/api/teachers',      teachersRouter);
app.use('/api/classes',       classesRouter);
app.use('/api/students',      studentsRouter);
app.use('/api/parents',       parentsRouter);
app.use('/api/attendance',    attendanceRouter);
app.use('/api/attendance-qr', attendanceQrRouter);
app.use('/api/timetable',     timetableRouter);
app.use('/api/marks',         marksRouter);
app.use('/api/marks-settings', marksSettingsRouter);
app.use('/api/report-cards',  reportCardsRouter);
app.use('/api/report-card-template', reportCardTemplateRouter);
app.use('/api/certificates',  certificatesRouter);
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
app.use('/api/platform/licenses',      platformLicensesRouter);

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
bootstrap()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`\n🚀  School Management API running on http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   Docs:   see README for full endpoint list\n`);
      // Signal Electron main process that the server is ready
      if (process.send) process.send({ type: 'ready', port: Number(PORT) });
    });
  })
  .catch((e) => {
    console.error('[server] Bootstrap failed:', e);
    process.exit(1);
  });

module.exports = app;
