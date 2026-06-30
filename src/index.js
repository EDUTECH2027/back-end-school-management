require('dotenv').config();
const path      = require('path');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');

const { createSchema }   = require('./db/schema');
const errorHandler       = require('./middleware/errorHandler');

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

// ── Bootstrap DB ─────────────────────────────────────────────────────────────
createSchema();

// ── Auto-seed on first run (set AUTO_SEED=1 to enable) ───────────────────────
if (process.env.AUTO_SEED === '1') {
  try {
    const _db = require('./db/database');
    const { n } = _db.prepare('SELECT COUNT(*) AS n FROM users').get();
    if (n === 0) {
      console.log('[server] Empty database — seeding demo data...');
      require('./db/seed');
    }
  } catch (e) {
    console.error('[server] Auto-seed error:', e.message);
  }
}

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
