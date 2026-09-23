/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
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
router.get('/', authenticate, async (req, res) => {
  const { termId, classId, studentId, subjectId } = req.query;
  const where = {};
  if (termId) where.term_id = termId;
  if (classId) where.class_id = classId;
  if (studentId) where.student_id = studentId;
  if (subjectId) where.subject_id = subjectId;
  res.json(await req.db.mark.findMany({ where }));
});

// POST /api/marks  — bulk upsert
router.post('/', authenticate, async (req, res) => {
  const records = req.body;
  if (!Array.isArray(records)) return res.status(422).json({ error: 'Body must be an array' });
  if (records.length === 0) return res.status(201).json({ saved: 0 });

  // Validate that the referenced term and subject exist before starting inserts.
  // This gives a clear error instead of a cryptic FK constraint message.
  const firstRecord = records.find(r => r.termId && r.subjectId);
  if (firstRecord) {
    const termExists = await req.db.term.findUnique({ where: { id: firstRecord.termId } });
    const subjectExists = await req.db.subject.findUnique({ where: { id: firstRecord.subjectId } });
    if (!termExists) return res.status(422).json({ error: `Term not found: ${firstRecord.termId}` });
    if (!subjectExists) return res.status(422).json({ error: `Subject not found: ${firstRecord.subjectId}` });
  }

  let saved = 0;
  const errors = [];
  for (const r of records) {
    if (!r.studentId || !r.subjectId || !r.termId) continue;
    try {
      const total = Math.round(((r.caScore || 0) + (r.examScore || 0)) / 2);
      const { grade, remark } = gradeFor(total);
      await req.db.mark.upsert({
        where: { marks_student_subject_term: { student_id: r.studentId, subject_id: r.subjectId, term_id: r.termId } },
        update: { ca_score: r.caScore || 0, exam_score: r.examScore || 0, total_score: total, grade: r.grade || grade, remark: r.remark || remark, updated_at: new Date() },
        create: {
          id: r.id || uuid(), student_id: r.studentId, student_name: r.studentName || null, student_number: r.studentNumber || null,
          subject_id: r.subjectId, subject_name: r.subjectName || null, term_id: r.termId, class_id: r.classId || null,
          ca_score: r.caScore || 0, exam_score: r.examScore || 0, total_score: total, grade: r.grade || grade, remark: r.remark || remark,
        },
      });
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
router.put('/:id', authenticate, async (req, res) => {
  const { caScore, examScore, grade, remark } = req.body;
  const total = Math.round(((caScore || 0) + (examScore || 0)) / 2);
  const auto = gradeFor(total);
  const updated = await req.db.mark.update({
    where: { id: req.params.id },
    data: { ca_score: caScore || 0, exam_score: examScore || 0, total_score: total, grade: grade || auto.grade, remark: remark || auto.remark, updated_at: new Date() },
  });
  res.json(updated);
});

module.exports = router;
