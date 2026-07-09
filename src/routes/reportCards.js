const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const ENTRIES_INCLUDE = { entries: { orderBy: { subject_name: 'asc' } } };
const withEntries = (card) => card;

// POST /api/report-cards/generate — build cards from saved marks for a class+term
// Must be defined before /:id to avoid route collision
router.post('/generate', authenticate, async (req, res) => {
  const { classId, termId } = req.body;
  if (!classId || !termId) return res.status(422).json({ error: 'classId and termId required' });

  const term = await req.db.term.findUnique({ where: { id: termId } });
  if (!term) return res.status(404).json({ error: 'Term not found' });
  const ay = await req.db.academicYear.findUnique({ where: { id: term.academic_year_id } });

  const students = await req.db.student.findMany({
    where: { class_id: classId, is_active: true },
    orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
  });
  if (students.length === 0) return res.status(422).json({ error: 'No active students in this class' });

  const allMarks = await req.db.mark.findMany({ where: { class_id: classId, term_id: termId } });

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

  let generated = 0;
  try {
    // Wrapped in one transaction (a genuine reliability fix over the original,
    // which left partial writes on a mid-loop failure since node:sqlite's
    // db.transaction() wasn't used here).
    await req.db.$transaction(async (tx) => {
      for (const student of students) {
        const stuMarks = marksByStudent[student.id] || {};
        // Totals computed over the full canonical subject list so denominator is identical for everyone
        const totalObtained = allSubjects.reduce((s, sub) => s + (stuMarks[sub.subject_id]?.total_score || 0), 0);
        const totalPossible = allSubjects.length * 100;
        const pct = totalPossible > 0 ? Math.round((totalObtained / totalPossible) * 1000) / 10 : 0;
        const position = positions[student.id];

        const existing = await tx.reportCard.findFirst({ where: { student_id: student.id, term_id: termId } });
        let rcId;
        if (existing) {
          rcId = existing.id;
          await tx.reportCard.update({
            where: { id: rcId },
            data: { total_marks_obtained: totalObtained, total_marks_possible: totalPossible, percentage: pct, class_position: position, out_of: students.length, updated_at: new Date() },
          });
        } else {
          rcId = uuid();
          await tx.reportCard.create({
            data: {
              id: rcId, student_id: student.id,
              student_name: student.first_name + ' ' + student.last_name,
              student_number: student.student_number,
              class_name: student.class_name, grade_level_name: student.grade_level_name,
              term_id: termId, term_name: term.name, academic_year: ay?.label || '',
              total_marks_obtained: totalObtained, total_marks_possible: totalPossible, percentage: pct,
              class_position: position, out_of: students.length,
              days_present: 0, days_absent: 0, total_school_days: 0,
              conduct: 'Good', class_teacher_comment: null, head_teacher_comment: null, status: 'draft',
            },
          });
        }

        // Write one entry per subject in the canonical list; students with no mark get 0s
        await tx.reportCardEntry.deleteMany({ where: { report_card_id: rcId } });
        if (allSubjects.length > 0) {
          await tx.reportCardEntry.createMany({
            data: allSubjects.map(sub => {
              const m = stuMarks[sub.subject_id];
              return {
                id: uuid(), report_card_id: rcId, subject_id: sub.subject_id, subject_name: sub.subject_name,
                ca_score: m?.ca_score || 0, exam_score: m?.exam_score || 0, total_score: m?.total_score || 0,
                grade: m?.grade || null, remark: m?.remark || null, position: null, teacher_comment: null,
              };
            }),
          });
        }
        generated++;
      }
    });
  } catch (err) {
    console.error('[generate report cards]', err.message);
    return res.status(500).json({ error: err.message });
  }

  res.status(201).json({ generated });
});

// GET /api/report-cards?termId=t1&classId=c4&studentId=st6&status=published
router.get('/', authenticate, async (req, res) => {
  const { termId, classId, studentId, status } = req.query;
  const where = {};
  if (termId) where.term_id = termId;
  if (classId) where.student = { class_id: classId };
  if (studentId) where.student_id = studentId;
  if (status) where.status = status;
  try {
    const rows = await req.db.reportCard.findMany({
      where, include: ENTRIES_INCLUDE,
      orderBy: [{ class_position: 'asc' }, { student_name: 'asc' }],
    });
    res.json(rows.map(withEntries));
  } catch (err) {
    console.error('[GET /report-cards]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/report-cards/:id
router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.reportCard.findUnique({ where: { id: req.params.id }, include: ENTRIES_INCLUDE });
  if (!row) return res.status(404).json({ error: 'Report card not found' });
  res.json(withEntries(row));
});

// POST /api/report-cards
router.post('/', authenticate, async (req, res) => {
  const { studentId, termId, classTeacherComment, headTeacherComment, conduct,
          daysPresent, daysAbsent, totalSchoolDays, entries = [] } = req.body;
  if (!studentId || !termId) return res.status(422).json({ error: 'studentId and termId required' });

  const student = await req.db.student.findUnique({ where: { id: studentId } });
  const term = await req.db.term.findUnique({ where: { id: termId } });
  const ay = term ? await req.db.academicYear.findUnique({ where: { id: term.academic_year_id } }) : null;
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const totalObtained = entries.reduce((s, e) => s + (e.totalScore || 0), 0);
  const totalPossible = entries.length * 100;
  const pct = totalPossible > 0 ? Math.round((totalObtained / totalPossible) * 1000) / 10 : 0;

  const id = uuid();
  try {
    await req.db.reportCard.create({
      data: {
        id, student_id: studentId, student_name: student.first_name + ' ' + student.last_name, student_number: student.student_number,
        class_name: student.class_name, grade_level_name: student.grade_level_name, term_id: termId,
        term_name: term?.name || '', academic_year: ay?.label || '',
        total_marks_obtained: totalObtained, total_marks_possible: totalPossible, percentage: pct,
        class_position: null, out_of: null,
        days_present: daysPresent || 0, days_absent: daysAbsent || 0, total_school_days: totalSchoolDays || 0,
        conduct: conduct || null, class_teacher_comment: classTeacherComment || null, head_teacher_comment: headTeacherComment || null, status: 'draft',
      },
    });

    if (entries.length > 0) {
      await req.db.reportCardEntry.createMany({
        data: entries.map(e => ({
          id: uuid(), report_card_id: id, subject_id: e.subjectId, subject_name: e.subjectName || null,
          ca_score: e.caScore || 0, exam_score: e.examScore || 0, total_score: e.totalScore || 0,
          grade: e.grade || null, remark: e.remark || null, position: e.position || null, teacher_comment: e.teacherComment || null,
        })),
      });
    }
  } catch (err) {
    console.error('[POST /report-cards]', err.message);
    return res.status(500).json({ error: err.message });
  }

  const created = await req.db.reportCard.findUnique({ where: { id }, include: ENTRIES_INCLUDE });
  res.status(201).json(withEntries(created));
});

// PUT /api/report-cards/:id
router.put('/:id', authenticate, async (req, res) => {
  const { classTeacherComment, headTeacherComment, conduct,
          daysPresent, daysAbsent, totalSchoolDays, status, entries } = req.body;
  try {
    await req.db.reportCard.update({
      where: { id: req.params.id },
      data: {
        class_teacher_comment: classTeacherComment || null, head_teacher_comment: headTeacherComment || null, conduct: conduct || null,
        days_present: daysPresent || 0, days_absent: daysAbsent || 0, total_school_days: totalSchoolDays || 0,
        status: status || 'draft', updated_at: new Date(),
      },
    });

    if (Array.isArray(entries)) {
      await req.db.reportCardEntry.deleteMany({ where: { report_card_id: req.params.id } });
      if (entries.length > 0) {
        await req.db.reportCardEntry.createMany({
          data: entries.map(e => ({
            id: uuid(), report_card_id: req.params.id, subject_id: e.subjectId, subject_name: e.subjectName || null,
            ca_score: e.caScore || 0, exam_score: e.examScore || 0, total_score: e.totalScore || 0,
            grade: e.grade || null, remark: e.remark || null, position: e.position || null, teacher_comment: e.teacherComment || null,
          })),
        });
      }
    }
  } catch (err) {
    console.error('[PUT /report-cards]', err.message);
    return res.status(500).json({ error: err.message });
  }

  const updated = await req.db.reportCard.findUnique({ where: { id: req.params.id }, include: ENTRIES_INCLUDE });
  res.json(withEntries(updated));
});

// PATCH /api/report-cards/:id/status
router.patch('/:id/status', authenticate, async (req, res) => {
  const { status } = req.body;
  const valid = ['draft', 'finalized', 'published', 'printed'];
  if (!valid.includes(status)) return res.status(422).json({ error: `status must be one of: ${valid.join(', ')}` });
  const updated = await req.db.reportCard.update({ where: { id: req.params.id }, data: { status, updated_at: new Date() } });
  res.json(updated);
});

module.exports = router;
