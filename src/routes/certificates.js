const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

// GET /api/certificates?studentId=xxx
router.get('/', authenticate, async (req, res) => {
  const { studentId } = req.query;
  res.json(await req.db.certificate.findMany({
    where: studentId ? { student_id: studentId } : undefined,
    orderBy: { created_at: 'desc' },
  }));
});

router.get('/:id', authenticate, async (req, res) => {
  const cert = await req.db.certificate.findUnique({ where: { id: req.params.id } });
  if (!cert) return res.status(404).json({ error: 'Certificate not found' });
  res.json(cert);
});

router.post('/', authenticate, async (req, res) => {
  const {
    studentId, studentName, studentNumber, className,
    docTypeId, themeId, kind, docLabel, bodyHtml, recipientName,
    issueDate, certNumber, signatoryName, signatoryTitle, style,
  } = req.body;

  if (!studentId || !docTypeId || !themeId || !docLabel || !recipientName) {
    return res.status(422).json({ error: 'studentId, docTypeId, themeId, docLabel and recipientName are required' });
  }

  const id = uuid();
  const created = await req.db.certificate.create({
    data: {
      id, student_id: studentId, student_name: studentName || null, student_number: studentNumber || null,
      class_name: className || null, doc_type_id: docTypeId, theme_id: themeId, kind: kind || 'certificate',
      doc_label: docLabel, body_html: bodyHtml || '', recipient_name: recipientName,
      issue_date: issueDate || '', cert_number: certNumber || '', signatory_name: signatoryName || null,
      signatory_title: signatoryTitle || null, style: style || undefined, created_by: req.user.name || null,
    },
  });
  res.status(201).json(created);
});

router.put('/:id', authenticate, async (req, res) => {
  const current = await req.db.certificate.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'Certificate not found' });

  const {
    themeId, docLabel, bodyHtml, recipientName,
    issueDate, certNumber, signatoryName, signatoryTitle, style,
  } = req.body;

  const updated = await req.db.certificate.update({
    where: { id: req.params.id },
    data: {
      theme_id: themeId ?? current.theme_id,
      doc_label: docLabel ?? current.doc_label,
      body_html: bodyHtml ?? current.body_html,
      recipient_name: recipientName ?? current.recipient_name,
      issue_date: issueDate ?? current.issue_date,
      cert_number: certNumber ?? current.cert_number,
      signatory_name: signatoryName ?? current.signatory_name,
      signatory_title: signatoryTitle ?? current.signatory_title,
      style: style !== undefined ? style : current.style,
      updated_at: new Date(),
    },
  });
  res.json(updated);
});

router.delete('/:id', authenticate, async (req, res) => {
  await req.db.certificate.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
