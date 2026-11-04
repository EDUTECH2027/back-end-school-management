/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

function computeStatus(row) {
  const is_enabled = row?.is_enabled ?? false;
  const opens_at = row?.opens_at ?? null;
  const closes_at = row?.closes_at ?? null;

  let is_open = true;
  if (is_enabled) {
    const now = new Date();
    is_open = (!opens_at || now >= opens_at) && (!closes_at || now <= closes_at);
  }

  return { is_enabled, opens_at, closes_at, is_open };
}

async function getMarksEntryStatus(db) {
  const row = await db.marksEntryPeriod.findUnique({ where: { id: 's1' } });
  return computeStatus(row);
}

// Each term holds two sequences: first = 1-2, second = 3-4, third = 5-6. The first mark of a
// term (ca_score) is its odd sequence, the second (exam_score) its even one.
const SEQUENCES = [1, 2, 3, 4, 5, 6];
const TERM_SEQUENCES = { first: [1, 2], second: [3, 4], third: [5, 6] };

// Per-sequence status. is_open = the admin's session flag; can_enter = what a teacher may actually do
// (session open AND, when the optional time window is enforced, inside that window).
async function getSequenceStatuses(db) {
  const [rows, window] = await Promise.all([db.marksEntrySession.findMany(), getMarksEntryStatus(db)]);
  const byNumber = new Map(rows.map((r) => [r.sequence, r]));
  return SEQUENCES.map((sequence) => {
    const row = byNumber.get(sequence);
    const is_open = !!row?.is_open;
    return { sequence, is_open, can_enter: is_open && window.is_open, opened_at: row?.opened_at ?? null, closed_at: row?.closed_at ?? null };
  });
}

// GET /api/marks-settings — any authenticated user (admin settings page + teacher portal both read this)
router.get('/', authenticate, async (req, res) => {
  const row = await req.db.marksEntryPeriod.findUnique({ where: { id: 's1' } });
  res.json({ ...computeStatus(row), sequences: await getSequenceStatuses(req.db) });
});

// POST /api/marks-settings/sessions/:sequence/open | close — admin only. Touches ONLY that sequence.
const parseSequence = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
};

const setSession = (isOpen) => async (req, res) => {
  const sequence = parseSequence(req.params.sequence);
  if (!sequence) return res.status(422).json({ error: 'sequence must be a whole number from 1 to 6' });
  const now = new Date();
  const data = isOpen
    ? { is_open: true, opened_at: now, closed_at: null, updated_by: req.user.id, updated_at: now }
    : { is_open: false, closed_at: now, updated_by: req.user.id, updated_at: now };
  await req.db.marksEntrySession.upsert({
    where: { sequence },
    update: data,
    create: { sequence, ...data },
  });
  res.json({ sequences: await getSequenceStatuses(req.db) });
};
router.post('/sessions/:sequence/open', authenticate, authorize('super_admin'), setSession(true));
router.post('/sessions/:sequence/close', authenticate, authorize('super_admin'), setSession(false));

// PUT /api/marks-settings — admin only
router.put('/', authenticate, authorize('super_admin'), async (req, res) => {
  const { is_enabled, opens_at, closes_at } = req.body;
  const row = await req.db.marksEntryPeriod.upsert({
    where: { id: 's1' },
    update: {
      is_enabled: is_enabled ?? false,
      opens_at: opens_at ? new Date(opens_at) : null,
      closes_at: closes_at ? new Date(closes_at) : null,
      updated_at: new Date(),
    },
    create: {
      id: 's1',
      is_enabled: is_enabled ?? false,
      opens_at: opens_at ? new Date(opens_at) : null,
      closes_at: closes_at ? new Date(closes_at) : null,
    },
  });
  res.json({ ...computeStatus(row), sequences: await getSequenceStatuses(req.db) });
});

module.exports = router;
module.exports.getMarksEntryStatus = getMarksEntryStatus;
module.exports.getSequenceStatuses = getSequenceStatuses;
module.exports.TERM_SEQUENCES = TERM_SEQUENCES;
