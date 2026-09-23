// Monthly QR-code teacher attendance: generation/management (admin) and
// scanning (teacher self-service). Mounted at /api/attendance-qr.

const router = require('express').Router();
const { v4: uuid } = require('uuid');
const qrcode = require('qrcode');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { generateToken, monthKey, endOfMonth, dateKey, classifyArrival } = require('../utils/attendanceQr');

const SETTINGS_ID = 's1';

// ── Settings (arrival threshold) ────────────────────────────────────────────

// GET /api/attendance-qr/settings — any authenticated user (teacher portal reads
// this too, same pattern as marksSettings.js).
router.get('/settings', authenticate, async (req, res) => {
  const row = await req.db.attendanceSettings.findUnique({ where: { id: SETTINGS_ID } });
  res.json({ arrival_threshold: row?.arrival_threshold ?? '07:30' });
});

// PUT /api/attendance-qr/settings — admin only
router.put('/settings', authenticate, authorize('super_admin'), async (req, res) => {
  const { arrival_threshold } = req.body;
  if (!/^\d{2}:\d{2}$/.test(arrival_threshold || '')) {
    return res.status(422).json({ error: 'arrival_threshold must be "HH:MM"' });
  }
  const row = await req.db.attendanceSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { arrival_threshold, updated_at: new Date() },
    create: { id: SETTINGS_ID, arrival_threshold },
  });
  res.json({ arrival_threshold: row.arrival_threshold });
});

// ── QR code management (admin) ──────────────────────────────────────────────

// GET /api/attendance-qr/current — this month's poster, redrawn on demand.
router.get('/current', authenticate, async (req, res) => {
  const month = monthKey();
  const row = await req.db.attendanceQrCode.findUnique({ where: { month } });
  if (!row || row.revoked_at) {
    return res.status(404).json({ error: 'No active QR code for this month yet.' });
  }
  const qr = await qrcode.toDataURL(row.token, { margin: 1, width: 320 });
  res.json({
    id: row.id, month: row.month, created_at: row.created_at, expires_at: row.expires_at,
    qr,
  });
});

// POST /api/attendance-qr/generate — admin only. Replaces this month's code.
router.post('/generate', authenticate, authorize('super_admin'), async (req, res) => {
  const month = monthKey();
  const token = generateToken();
  const row = await req.db.attendanceQrCode.upsert({
    where: { month },
    update: { token, created_by: req.user.id, created_at: new Date(), expires_at: endOfMonth(month), revoked_at: null },
    create: { id: uuid(), month, token, created_by: req.user.id, expires_at: endOfMonth(month) },
  });
  const qr = await qrcode.toDataURL(token, { margin: 1, width: 320 });
  res.status(201).json({
    id: row.id, month: row.month, created_at: row.created_at, expires_at: row.expires_at,
    qr,
  });
});

// POST /api/attendance-qr/revoke — admin only. Kills this month's code early.
router.post('/revoke', authenticate, authorize('super_admin'), async (req, res) => {
  const month = monthKey();
  const row = await req.db.attendanceQrCode.findUnique({ where: { month } });
  if (!row || row.revoked_at) return res.status(404).json({ error: 'No active QR code for this month.' });
  await req.db.attendanceQrCode.update({ where: { month }, data: { revoked_at: new Date() } });
  res.json({ revoked: true });
});

// ── Scanning (teacher self-service) ─────────────────────────────────────────

// POST /api/attendance-qr/scan  { token }
router.post('/scan', authenticate, authorize('teacher'), async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') return res.status(422).json({ error: 'token required' });

  const teacherId = req.user.teacher_id;
  if (!teacherId) return res.status(403).json({ error: 'No teacher profile linked to this account.' });

  const qr = await req.db.attendanceQrCode.findUnique({ where: { token } });
  const now = new Date();
  if (!qr || qr.revoked_at || qr.month !== monthKey(now) || qr.expires_at.getTime() < now.getTime()) {
    return res.status(400).json({ error: 'This QR code is invalid or has expired. Ask the office for the current one.' });
  }

  const date = dateKey(now);
  const existing = await req.db.teacherAttendance.findFirst({ where: { teacher_id: teacherId, date } });
  if (existing && existing.source === 'qr_scan') {
    return res.status(409).json({
      error: `You already scanned in today at ${existing.scan_time ? existing.scan_time.toISOString().slice(11, 16) : 'an earlier time'}.`,
    });
  }

  const settings = await req.db.attendanceSettings.findUnique({ where: { id: SETTINGS_ID } });
  const threshold = settings?.arrival_threshold ?? '07:30';
  const status = classifyArrival(now, threshold);

  const saved = await req.db.teacherAttendance.upsert({
    where: { teacher_attendance_teacher_date: { teacher_id: teacherId, date } },
    update: { status, scan_time: now, qr_code_id: qr.id, source: 'qr_scan', remarks: null },
    create: { id: uuid(), teacher_id: teacherId, date, status, scan_time: now, qr_code_id: qr.id, source: 'qr_scan' },
    include: { teacher: { select: { id: true, first_name: true, last_name: true, email: true } } },
  });

  res.status(201).json({ ...saved, teacher: saved.teacher });
});

module.exports = router;
