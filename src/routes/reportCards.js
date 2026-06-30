const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const getEntries = db.prepare('SELECT * FROM report_card_entries WHERE report_card_id=? ORDER BY subject_name');

const withEntries = (card) => {
  if (!card) return null;
  return { ...card, entries: getEntries.all(card.id) };
};

// POST /api/report-cards/generate — build cards from saved marks for a class+term
// Must be defined before /:id to avoid route collision
router.post('/generate', authenticate, (req, res) => {
  const { classId, termId } = req.body;
  if (!classId || !termId) return res.status(422).json({ error: 'classId and termId required' });

  const term = db.prepare('SELECT * FROM terms WHERE id=?').get(termId);
  if (!term) return res.status(404).json({ error: 'Term not found' });
  const ay = db.prepare('SELECT label FROM academic_years WHERE id=?').get(term.academic_year_id);

  const students = db.prepare(
    'SELECT * FROM students WHERE class_id=? AND is_active=1 ORDER BY last_name, first_name'
  ).all(classId);
  if (students.length === 0) return res.status(422).json({ error: 'No active students in this class' });

  const allMarks = db.prepare('SELECT * FROM marks WHERE class_id=? AND term_id=?').all(classId, termId);

  // Build the full canonical subject list for this class+term (union of all subjects with any mark)
  const subjectMap = {};
  allMarks.forEach(m => {
    if (!subjectMap[m.subject_id]) subjectMap[m.subject_id] = m.subject_name || m.subject_id;
  });
  const allSubjects = Object.entries(subjectMap)
    .map(([id, name]) => ({ subject_id: id, subject_name: name }))
    .sort((a, b) => String(a.subject_name).localeCompare(String(b.subject_name)));

  // Build per-student mark lookup: studentId → subjectId → mark row
  const marksByStudent = {};
  allMarks.forEach(m => {
    if (!marksByStudent[m.student_id]) marksByStudent[m.student_id] = {};
    marksByStudent[m.student_id][m.subject_id] = m;
  });

  // Calculate each student's total over the SAME subject set (0 for any missing subject)
  // This ensures positions are fair regardless of how many subjects were entered per student
  const studentTotals = students.map(s => {
    const stuMarks = marksByStudent[s.id] || {};
    const total = allSubjects.reduce((sum, sub) => sum + (stuMarks[sub.subject_id]?.total_score || 0), 0);
    return { id: s.id, total };
  });

  // Standard competition ranking: tied students share the same rank (1, 1, 3, 4, …)
  const sorted = [...studentTotals].sort((a, b) => b.total - a.total);
  const positions = {};
  let rank = 1;
  sorted.forEach((s, i) => {
    if (i > 0 && sorted[i - 1].total !== s.total) rank = i + 1;
    positions[s.id] = rank;
  });

  const findRC      = db.prepare('SELECT id FROM report_cards WHERE student_id=? AND term_id=?');
  const insertRC    = db.prepare(`INSERT INTO report_cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  const updateRC    = db.prepare(`UPDATE report_cards SET total_marks_obtained=?,total_marks_possible=?,percentage=?,class_position=?,out_of=?,updated_at=datetime('now') WHERE id=?`);
  const delEntries  = db.prepare('DELETE FROM report_card_entries WHERE report_card_id=?');
  const insertEntry = db.prepare('INSERT INTO report_card_entries VALUES (?,?,?,?,?,?,?,?,?,?,?)');

  let generated = 0;
  try {
    for (const student of students) {
      const stuMarks      = marksByStudent[student.id] || {};
      // Totals computed over the full canonical subject list so denominator is identical for everyone
      const totalObtained = allSubjects.reduce((s, sub) => s + (stuMarks[sub.subject_id]?.total_score || 0), 0);
      const totalPossible = allSubjects.length * 100;
      const pct           = totalPossible > 0 ? Math.round((totalObtained / totalPossible) * 1000) / 10 : 0;
      const position      = positions[student.id];

      const existing = findRC.get(student.id, termId);
      let rcId;
      if (existing) {
        rcId = existing.id;
        updateRC.run(totalObtained, totalPossible, pct, position, students.length, rcId);
      } else {
        rcId = uuid();
        insertRC.run(
          rcId, student.id,
          student.first_name + ' ' + student.last_name,
          student.student_number,
          student.class_name, student.grade_level_name,
          termId, term.name, ay?.label || '',
          totalObtained, totalPossible, pct,
          position, students.length,
          0, 0, 0, 'Good', null, null, 'draft'
        );
      }

      // Write one entry per subject in the canonical list; students with no mark get 0s
      delEntries.run(rcId);
      for (const sub of allSubjects) {
        const m = stuMarks[sub.subject_id];
        insertEntry.run(
          uuid(), rcId, sub.subject_id, sub.subject_name,
          m?.ca_score || 0, m?.exam_score || 0, m?.total_score || 0,
          m?.grade || null, m?.remark || null, null, null
        );
      }
      generated++;
    }
  } catch (err) {
    console.error('[generate report cards]', err.message);
    return res.status(500).json({ error: err.message });
  }

  res.status(201).json({ generated });
});

// GET /api/report-cards?termId=t1&classId=c4&studentId=st6&status=published
router.get('/', authenticate, (req, res) => {
  const { termId, classId, studentId, status } = req.query;
  let sql = 'SELECT * FROM report_cards WHERE 1=1';
  const params = [];
  if (termId)    { sql += ' AND term_id=?';    params.push(termId); }
  if (classId)   { sql += ' AND (SELECT class_id FROM students WHERE id=report_cards.student_id)=?'; params.push(classId); }
  if (studentId) { sql += ' AND student_id=?'; params.push(studentId); }
  if (status)    { sql += ' AND status=?';     params.push(status); }
  sql += ' ORDER BY class_position, student_name';
  try {
    const stmt = db.prepare(sql);
    const rows = params.length ? stmt.all(...params) : stmt.all();
    res.json(rows.map(withEntries));
  } catch (err) {
    console.error('[GET /report-cards]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/report-cards/:id
router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM report_cards WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Report card not found' });
  res.json(withEntries(row));
});

// POST /api/report-cards
router.post('/', authenticate, (req, res) => {
  const { studentId, termId, classTeacherComment, headTeacherComment, conduct,
          daysPresent, daysAbsent, totalSchoolDays, entries = [] } = req.body;
  if (!studentId || !termId) return res.status(422).json({ error: 'studentId and termId required' });

  const student = db.prepare('SELECT * FROM students WHERE id=?').get(studentId);
  const term    = db.prepare('SELECT * FROM terms WHERE id=?').get(termId);
  const ay      = db.prepare('SELECT label FROM academic_years WHERE id=?').get(term?.academic_year_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const totalObtained = entries.reduce((s, e) => s + (e.totalScore || 0), 0);
  const totalPossible = entries.length * 100;
  const pct = totalPossible > 0 ? Math.round((totalObtained / totalPossible) * 1000) / 10 : 0;

  const id = uuid();
  try {
    db.prepare(`INSERT INTO report_cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
      .run(id, studentId, student.first_name + ' ' + student.last_name, student.student_number,
           student.class_name, student.grade_level_name, termId, term?.name || '', ay?.label || '',
           totalObtained, totalPossible, pct, null, null,
           daysPresent||0, daysAbsent||0, totalSchoolDays||0,
           conduct||null, classTeacherComment||null, headTeacherComment||null, 'draft');

    const insEntry = db.prepare('INSERT INTO report_card_entries VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const e of entries) {
      insEntry.run(uuid(), id, e.subjectId, e.subjectName||null, e.caScore||0, e.examScore||0,
                   e.totalScore||0, e.grade||null, e.remark||null, e.position||null, e.teacherComment||null);
    }
  } catch (err) {
    console.error('[POST /report-cards]', err.message);
    return res.status(500).json({ error: err.message });
  }

  res.status(201).json(withEntries(db.prepare('SELECT * FROM report_cards WHERE id=?').get(id)));
});

// PUT /api/report-cards/:id
router.put('/:id', authenticate, (req, res) => {
  const { classTeacherComment, headTeacherComment, conduct,
          daysPresent, daysAbsent, totalSchoolDays, status, entries } = req.body;
  try {
    db.prepare(`UPDATE report_cards SET class_teacher_comment=?,head_teacher_comment=?,conduct=?,
      days_present=?,days_absent=?,total_school_days=?,status=?,updated_at=datetime('now') WHERE id=?`)
      .run(classTeacherComment||null, headTeacherComment||null, conduct||null,
           daysPresent||0, daysAbsent||0, totalSchoolDays||0, status||'draft', req.params.id);

    if (Array.isArray(entries)) {
      db.prepare('DELETE FROM report_card_entries WHERE report_card_id=?').run(req.params.id);
      const ins = db.prepare('INSERT INTO report_card_entries VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const e of entries) {
        ins.run(uuid(), req.params.id, e.subjectId, e.subjectName||null, e.caScore||0, e.examScore||0,
                e.totalScore||0, e.grade||null, e.remark||null, e.position||null, e.teacherComment||null);
      }
    }
  } catch (err) {
    console.error('[PUT /report-cards]', err.message);
    return res.status(500).json({ error: err.message });
  }

  res.json(withEntries(db.prepare('SELECT * FROM report_cards WHERE id=?').get(req.params.id)));
});

// PATCH /api/report-cards/:id/status
router.patch('/:id/status', authenticate, (req, res) => {
  const { status } = req.body;
  const valid = ['draft', 'finalized', 'published', 'printed'];
  if (!valid.includes(status)) return res.status(422).json({ error: `status must be one of: ${valid.join(', ')}` });
  db.prepare("UPDATE report_cards SET status=?,updated_at=datetime('now') WHERE id=?").run(status, req.params.id);
  res.json(db.prepare('SELECT * FROM report_cards WHERE id=?').get(req.params.id));
});

module.exports = router;
