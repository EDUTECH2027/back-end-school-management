const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const parse = row => row ? { ...row, isActive: !!row.is_active } : null;

// GET /api/students
router.get('/', authenticate, (req, res) => {
  const { search, classId, isActive, page = 1, limit = 100 } = req.query;
  let sql = 'SELECT * FROM students WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR student_number LIKE ?)';
    const s = `%${search}%`; params.push(s, s, s);
  }
  if (classId) { sql += ' AND class_id=?'; params.push(classId); }
  if (isActive !== undefined) { sql += ' AND is_active=?'; params.push(isActive === 'true' ? 1 : 0); }
  sql += ' ORDER BY first_name LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  res.json(db.prepare(sql).all(...params).map(parse));
});

// GET /api/students/:id
router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Student not found' });
  res.json(parse(row));
});

// POST /api/students
router.post('/', authenticate, (req, res) => {
  const { firstName, lastName, dateOfBirth, gender, classId, className, gradeLevelName,
          guardianName, guardianPhone, guardianRelationship, admissionDate, address } = req.body;
  if (!firstName || !lastName) return res.status(422).json({ error: 'firstName and lastName required' });

  const year = new Date().getFullYear();
  const count = (db.prepare('SELECT COUNT(*) as c FROM students').get().c || 0) + 1;
  const studentNumber = `BSPS-${year}-${String(count).padStart(3, '0')}`;
  const id = uuid();

  db.prepare(`INSERT INTO students (id,student_number,first_name,last_name,date_of_birth,gender,class_id,class_name,grade_level_name,photo_url,guardian_name,guardian_phone,guardian_relationship,admission_date,is_active,address,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, studentNumber, firstName, lastName, dateOfBirth||null, gender||null,
         classId||null, className||null, gradeLevelName||null, null,
         guardianName||null, guardianPhone||null, guardianRelationship||null,
         admissionDate||null, 1, address||null);
  res.status(201).json(parse(db.prepare('SELECT * FROM students WHERE id=?').get(id)));
});

// PUT /api/students/:id
router.put('/:id', authenticate, (req, res) => {
  const { firstName, lastName, dateOfBirth, gender, classId, className, gradeLevelName,
          guardianName, guardianPhone, guardianRelationship, admissionDate, address, isActive, photoUrl } = req.body;
  db.prepare(`UPDATE students SET first_name=?,last_name=?,date_of_birth=?,gender=?,class_id=?,
    class_name=?,grade_level_name=?,guardian_name=?,guardian_phone=?,guardian_relationship=?,
    admission_date=?,is_active=?,address=?,photo_url=?,updated_at=datetime('now') WHERE id=?`)
    .run(firstName, lastName, dateOfBirth||null, gender||null, classId||null,
         className||null, gradeLevelName||null, guardianName||null, guardianPhone||null,
         guardianRelationship||null, admissionDate||null, isActive !== false ? 1 : 0,
         address||null, photoUrl||null, req.params.id);
  res.json(parse(db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id)));
});

// DELETE /api/students/:id  (soft delete)
router.delete('/:id', authenticate, (req, res) => {
  db.prepare("UPDATE students SET is_active=0, updated_at=datetime('now') WHERE id=?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
