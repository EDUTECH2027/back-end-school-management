/**
 * Clean-slate initialisation.
 * Wipes all user-entered data and re-creates only the structural
 * seed rows needed to operate the app (grade levels, subjects, one admin user).
 * Run once when deploying to a fresh school:
 *   node src/db/clean.js
 */
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { createSchema } = require('./schema');

createSchema();

const run = db.transaction(() => {
  // ── Wipe everything in safe dependency order ──────────────────────
  db.exec(`
    DELETE FROM forum_messages;
    DELETE FROM forum_threads;
    DELETE FROM email_alerts;
    DELETE FROM announcements;
    DELETE FROM teacher_payroll;
    DELETE FROM payments;
    DELETE FROM fee_records;
    DELETE FROM report_card_entries;
    DELETE FROM report_cards;
    DELETE FROM marks;
    DELETE FROM teacher_schedule;
    DELETE FROM teacher_attendance;
    DELETE FROM attendance_records;
    DELETE FROM parent_students;
    DELETE FROM parents;
    DELETE FROM students;
    DELETE FROM classes;
    DELETE FROM teachers;
    DELETE FROM terms;
    DELETE FROM academic_years;
    DELETE FROM grade_levels;
    DELETE FROM subjects;
    DELETE FROM school;
    DELETE FROM users;
  `);

  // ── Placeholder school (user fills in via Settings) ───────────────
  db.prepare(`INSERT INTO school VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
    's1', 'My School', '', '', '', '', '', '', null
  );

  // ── Grade levels (standard Zimbabwe primary structure) ────────────
  const insGL = db.prepare(`INSERT INTO grade_levels VALUES (?,?,?)`);
  [
    ['gl0', 'ECD A',   0],
    ['gl1', 'ECD B',   1],
    ['gl2', 'Grade 1', 2],
    ['gl3', 'Grade 2', 3],
    ['gl4', 'Grade 3', 4],
    ['gl5', 'Grade 4', 5],
    ['gl6', 'Grade 5', 6],
    ['gl7', 'Grade 6', 7],
    ['gl8', 'Grade 7', 8],
  ].forEach(r => insGL.run(...r));

  // ── Core subjects ─────────────────────────────────────────────────
  const insSub = db.prepare(`INSERT INTO subjects VALUES (?,?,?)`);
  [
    ['sub1', 'English Language',   'ENG'],
    ['sub2', 'Mathematics',        'MTH'],
    ['sub3', 'General Science',    'SCI'],
    ['sub4', 'Social Studies',     'SST'],
    ['sub5', 'Shona',              'SHO'],
    ['sub6', 'Religious & Moral',  'RME'],
    ['sub7', 'Art & Craft',        'ART'],
    ['sub8', 'Physical Education', 'PE' ],
  ].forEach(r => insSub.run(...r));

  // ── Default admin account ─────────────────────────────────────────
  db.prepare(`INSERT INTO users VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(
    uuidv4(),
    'Administrator',
    'admin@school.com',
    bcrypt.hashSync('Admin@2025', 10),
    'head_teacher',
    'AD',
    null
  );
});

run();
console.log('✓ Database cleaned. Fresh start — all fake data removed.');
console.log('  Login: admin@school.com  /  Admin@2025');
