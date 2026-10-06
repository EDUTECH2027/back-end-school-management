/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Receives Meta's WhatsApp webhooks so the app learns what happened to a message AFTER
// Meta accepted it (delivered / read / failed + the real error code).
//
//   GET  /api/webhooks/whatsapp   one-time verification handshake (hub.* query params)
//   POST /api/webhooks/whatsapp   status events, signed with X-Hub-Signature-256
//
// Configure on Meta: WhatsApp → Configuration → Webhook → callback URL
//   https://<your-api-host>/api/webhooks/whatsapp , verify token = WHATSAPP_WEBHOOK_VERIFY_TOKEN,
// then subscribe to the "messages" field. WHATSAPP_APP_SECRET (App settings → Basic) signs the events.
const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const platformClient = require('../db/platformClient');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ── Verification handshake ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (expected && req.query['hub.mode'] === 'subscribe' && safeEqual(req.query['hub.verify_token'] || '', expected)) {
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

// ── Events ──────────────────────────────────────────────────────────────────
function validSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const header = req.get('x-hub-signature-256') || '';
  if (!secret || !req.rawBody || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(header.slice(7), expected);
}

// Only the outcomes worth recording; "sent" (left Meta's servers) adds nothing over "accepted".
const RECORDED = new Set(['delivered', 'read', 'failed']);

async function recordStatus(s) {
  if (!RECORDED.has(s.status) || !s.id) return;
  // Which school was this message for? Find the log row written when we sent it.
  const origin = await platformClient.systemLog.findFirst({
    where: { action: 'school.whatsapp_sent', meta: { string_contains: s.id } },
    orderBy: { created_at: 'desc' },
    select: { target_id: true },
  });
  const err = (s.errors && s.errors[0]) || null;
  await platformClient.systemLog.create({
    data: {
      id: uuid(),
      actor_type: 'system',
      action: `school.whatsapp_${s.status}`,
      target_type: 'school',
      target_id: origin?.target_id || null,
      meta: {
        message_id: s.id,
        status: s.status,
        to_last4: String(s.recipient_id || '').slice(-4),
        ...(err ? { code: err.code, error: err.error_data?.details || err.message || err.title } : {}),
      },
    },
  });
}

router.post('/', async (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast; Meta retries on slow/failed responses

  try {
    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        for (const s of change.value?.statuses || []) await recordStatus(s);
      }
    }
  } catch (e) {
    console.error('[whatsapp webhook] processing error:', e.message);
  }
});

module.exports = router;
