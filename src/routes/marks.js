const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const gradeFor = (score) => {
  if (score >= 90) return { grade: 'A+', remark: 'Excellent' };
  if (score >= 80) return { grade: 'A',  remark: 'Very Good' };
  if (score >= 70) return { grade: 'B',  remark: 'Good' };
  if (score >= 60) return { grade: 'C',  remark: 'Average' };
  if (score >= 50) return { grade: 'D',  remark: 'Below Average' };
  return { grade: 'F', remark: 'Fail' };
};

// GET /api/marks?termId=t1&classId=c4&studentId=st6&subjectId=sub1
router.get('/', authenticate, (req, res) => {
  const { termId, classId, studentId, subjectId } = req.query;
  let sql = 'SELECT * FROM marks WHERE 1=1';
  const params = [];
  if (termId)    { sql += ' AND term_id=?';    params.push(termId); }
  if (classId)   { sql += ' AND class_id=?';   params.push(classId); }
  if (studentId) { sql += ' AND student_id=?'; params.push(studentId); }
  if (subjectId) { sql += ' AND subject_id=?'; params.push(subjectId); }
  const stmt = db.prepare(sql);
  res.json(params.length ? stmt.all(...params) : stmt.all());
});

// POST /api/marks  — bulk upsert
router.post('/', authenticate, (req, res) => {
  const records = req.body;
  if (!Array.isArray(records)) return res.status(422).json({ error: 'Body must be an array' });
  if (records.length === 0) return res.status(201).json({ saved: 0 });

  const find   = db.prepare('SELECT id FROM marks WHERE student_id=? AND subject_id=? AND term_id=?');
  const update = db.prepare('UPDATE marks SET ca_score=?,exam_score=?,total_score=?,grade=?,remark=? WHERE id=?');
  const insert = db.prepare('INSERT INTO marks (id,student_id,student_name,student_number,subject_id,subject_name,term_id,class_id,ca_score,exam_score,total_score,grade,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');

  // Validate that the referenced term and subject exist before starting inserts.
  // This gives a clear error instead of a cryptic FK constraint message.
  const firstRecord = records.find(r => r.termId && r.subjectId);
  if (firstRecord) {
    const termExists    = db.prepare('SELECT 1 FROM terms WHERE id=?').get(firstRecord.termId);
    const subjectExists = db.prepare('SELECT 1 FROM subjects WHERE id=?').get(firstRecord.subjectId);
    if (!termExists)    return res.status(422).json({ error: `Term not found: ${firstRecord.termId}` });
    if (!subjectExists) return res.status(422).json({ error: `Subject not found: ${firstRecord.subjectId}` });
  }

  let saved = 0;
  const errors = [];
  for (const r of records) {
    if (!r.studentId || !r.subjectId || !r.termId) continue;
    try {
      const total = Math.round(((r.caScore || 0) + (r.examScore || 0)) / 2);
      const { grade, remark } = gradeFor(total);
      const existing = find.get(r.studentId, r.subjectId, r.termId);
      if (existing) {
        update.run(r.caScore||0, r.examScore||0, total, r.grade||grade, r.remark||remark, existing.id);
      } else {
        insert.run(r.id||uuid(), r.studentId, r.studentName||null, r.studentNumber||null,
          r.subjectId, r.subjectName||null, r.termId, r.classId||null,
          r.caScore||0, r.examScore||0, total, r.grade||grade, r.remark||remark);
      }
      saved++;
    } catch (err) {
      console.error(`[POST /api/marks] record skipped (${r.studentId}/${r.subjectId}):`, err.message);
      errors.push({ studentId: r.studentId, subjectId: r.subjectId, error: err.message });
    }
  }

  if (saved === 0 && errors.length > 0) {
    return res.status(500).json({ error: errors[0].error, details: errors });
  }
  res.status(201).json({ saved, ...(errors.length > 0 && { skipped: errors }) });
});

// PUT /api/marks/:id
router.put('/:id', authenticate, (req, res) => {
  const { caScore, examScore, grade, remark } = req.body;
  const total = Math.round(((caScore||0) + (examScore||0)) / 2);
  const auto  = gradeFor(total);
  db.prepare(`UPDATE marks SET ca_score=?,exam_score=?,total_score=?,grade=?,remark=? WHERE id=?`)
    .run(caScore||0, examScore||0, total, grade||auto.grade, remark||auto.remark, req.params.id);
  res.json(db.prepare('SELECT * FROM marks WHERE id=?').get(req.params.id));
});

module.exports = router;
