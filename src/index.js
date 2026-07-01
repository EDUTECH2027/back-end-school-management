require('dotenv').config();
const path      = require('path');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const bcrypt    = require('bcryptjs');
const db        = require('./db/database');

const { createSchema }   = require('./db/schema');
const errorHandler       = require('./middleware/errorHandler');

// ── Bootstrap DB — must run before any route module is loaded ─────────────────
// Route files (e.g. reportCards.js) call db.prepare() at the top level, so the
// tables must exist before require() evaluates those modules.
createSchema();

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

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function bootstrapUsers() {
  const admin = {
    id: 'u-admin-1',
    name: 'System Admin',
    email: 'admin@school.local',
    password: 'Admin@123',
    role: 'super_admin',
    initials: 'SA',
  };

  const teacher = {
    id: 'u-teacher-1',
    name: 'Demo Teacher',
    email: 'teacher@school.local',
    password: 'Teacher@123',
    role: 'teacher',
    initials: 'DT',
    teacherId: 'tc-bootstrap-1',
  };

  const student = {
    id: 'u-student-1',
    name: 'Demo Student',
    email: 'student@school.local',
    password: 'Student@123',
    role: 'student',
    initials: 'DS',
    studentId: 'st-bootstrap-1',
  };

  const parent = {
    id: 'u-parent-1',
    name: 'Demo Parent',
    email: 'parent@school.local',
    password: 'Parent@123',
    role: 'parent',
    initials: 'DP',
    parentId: 'par-bootstrap-1',
  };

  const selectUser = db.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = db.prepare(`INSERT INTO users (id, name, email, password_hash, role, initials, teacher_id, student_id, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`);
  const updateUserLinks = db.prepare('UPDATE users SET teacher_id = ?, student_id = ?, parent_id = ?, updated_at = datetime(\'now\') WHERE id = ?');

  const selectTeacher = db.prepare('SELECT * FROM teachers WHERE email = ?');
  const insertTeacher = db.prepare(`INSERT INTO teachers (id, first_name, last_name, email, phone, gender, subjects, class_assigned, qualification, join_date, is_active, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`);
  const updateTeacherUserId = db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?');

  const selectParent = db.prepare('SELECT * FROM parents WHERE email = ?');
  const insertParent = db.prepare(`INSERT INTO parents (id, name, email, phone, relationship, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`);
  const updateParentUserId = db.prepare('UPDATE parents SET user_id = ? WHERE id = ?');

  const selectStudent = db.prepare('SELECT * FROM students WHERE student_number = ?');
  const insertStudent = db.prepare(`INSERT INTO students (id, student_number, first_name, last_name, class_id, class_name, grade_level_name, admission_date, is_active, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`);
  const updateStudentUserId = db.prepare('UPDATE students SET user_id = ? WHERE id = ?');

  db.transaction(() => {
    // Admin
    const existingAdmin = selectUser.get(admin.email);
    if (!existingAdmin) {
      insertUser.run(admin.id, admin.name, admin.email, hashPassword(admin.password), admin.role, admin.initials, null, null, null);
    }

    // Teacher entity and user
    let existingTeacher = selectTeacher.get(teacher.email);
    if (!existingTeacher) {
      insertTeacher.run(
        teacher.teacherId,
        'Demo',
        'Teacher',
        teacher.email,
        '+0000000000',
        'other',
        '[]',
        null,
        'Demo Qualification',
        new Date().toISOString().slice(0, 10),
        1,
        teacher.id
      );
      existingTeacher = selectTeacher.get(teacher.email);
    }
    let existingTeacherUser = selectUser.get(teacher.email);
    if (!existingTeacherUser) {
      insertUser.run(teacher.id, teacher.name, teacher.email, hashPassword(teacher.password), teacher.role, teacher.initials, existingTeacher.id, null, null);
    } else if (!existingTeacherUser.teacher_id) {
      updateUserLinks.run(existingTeacher.id, null, null, existingTeacherUser.id);
    }
    if (existingTeacher && !existingTeacher.user_id) {
      updateTeacherUserId.run(teacher.id, existingTeacher.id);
    }

    // Student entity and user
    let existingStudent = selectStudent.get(student.studentId);
    if (!existingStudent) {
      insertStudent.run(
        student.studentId,
        student.studentId,
        'Demo',
        'Student',
        null,
        null,
        null,
        new Date().toISOString().slice(0, 10),
        1,
        student.id
      );
      existingStudent = selectStudent.get(student.studentId);
    }
    let existingStudentUser = selectUser.get(student.email);
    if (!existingStudentUser) {
      insertUser.run(student.id, student.name, student.email, hashPassword(student.password), student.role, student.initials, null, existingStudent.id, null);
    } else if (!existingStudentUser.student_id) {
      updateUserLinks.run(null, existingStudent.id, null, existingStudentUser.id);
    }
    if (existingStudent && !existingStudent.user_id) {
      updateStudentUserId.run(student.id, existingStudent.id);
    }

    // Parent entity and user
    let existingParent = selectParent.get(parent.email);
    if (!existingParent) {
      insertParent.run(
        parent.parentId,
        parent.name,
        parent.email,
        '+0000000001',
        'guardian',
        parent.id
      );
      existingParent = selectParent.get(parent.email);
    }
    let existingParentUser = selectUser.get(parent.email);
    if (!existingParentUser) {
      insertUser.run(parent.id, parent.name, parent.email, hashPassword(parent.password), parent.role, parent.initials, null, null, existingParent.id);
    } else if (!existingParentUser.parent_id) {
      updateUserLinks.run(null, null, existingParent.id, existingParentUser.id);
    }
    if (existingParent && !existingParent.user_id) {
      updateParentUserId.run(parent.id, existingParent.id);
    }
  })();
}

bootstrapUsers();

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
