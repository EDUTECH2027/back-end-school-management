/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Two-factor (TOTP) enrolment & management.  Mounted at /api/auth/2fa.
//
// Accepts either a normal access token (self-service from Settings) or an
// `enroll` purpose token (forced enrolment mid-login). `enroll`-mode principals
// can only reach /status and /enroll/*.

const router = require('express').Router();
const qrcode = require('qrcode');
const { body, validationResult } = require('express-validator');

const { authLimiter } = require('../middleware/rateLimit');
const { verifyAccess } = require('../auth/verify');
const { verifyPurposeToken } = require('../auth/mfaTokens');
const { encrypt, decrypt, isConfigured } = require('../auth/crypto');
const totp = require('../auth/totp');
const { loadSubject, issueTokenPair, killAllSessions } = require('../auth/tokens');
const { setRefreshCookie } = require('../auth/cookies');

// ── Principal resolution ────────────────────────────────────────────────────
async function principal(req, res, next) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  const token = header.slice(7);

  try {
    const sub = verifyPurposeToken(token, 'enroll');
    req.principal = { ...sub, mode: 'enroll' };
    return next();
  } catch { /* not an enroll token — try a real access token */ }

  try {
    const payload = await verifyAccess(token);
    req.principal = {
      subjectType: payload.scope === 'platform' ? 'platform' : 'tenant',
      subjectId: payload.id,
      schoolId: payload.school_id || null,
      role: payload.role,
      mode: 'full',
    };
    return next();
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  }
}

function requireFull(req, res, next) {
  if (req.principal.mode !== 'full') return res.status(403).json({ error: 'Not allowed with this token' });
  next();
}

function guardConfigured(req, res, next) {
  if (!isConfigured()) return res.status(503).json({ error: 'Two-factor is not available on this server (TOTP_ENC_KEY not set).' });
  next();
}

async function newSessionFor(req, res, sub) {
  // enrolment / disable changes token_version, so mint a fresh pair for the caller.
  const fresh = await loadSubject(sub);
  const pair = await issueTokenPair({
    subjectType: sub.subjectType, subjectId: sub.subjectId, schoolId: sub.schoolId,
    claims: fresh.claims, tokenVersion: fresh.tokenVersion, req,
  });
  setRefreshCookie(res, pair.refreshToken);
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    user: fresh.claims,
  };
}

router.use(principal);

// ── GET /status ─────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  const sub = req.principal;
  const s = await loadSubject(sub);
  if (!s) return res.status(404).json({ error: 'Account not found' });
  res.json({
    enabled: s.twoFactor.enabled,
    mandatory: s.twoFactor.mandatory,
    enrolled_at: s.row.totp_enrolled_at || null,
    recovery_remaining: totp.countUnusedRecovery(s.row.recovery_codes),
  });
});

// ── POST /enroll/start ──────────────────────────────────────────────────────
router.post('/enroll/start', guardConfigured, async (req, res) => {
  const sub = req.principal;
  const s = await loadSubject(sub);
  if (!s) return res.status(404).json({ error: 'Account not found' });
  if (s.twoFactor.enabled) return res.status(409).json({ error: 'Two-factor is already enabled.' });

  const secret = totp.generateSecret();
  const label = s.row.email || s.row.name || sub.subjectId;
  const otpauth = totp.keyUri(label, secret);

  // Stash the pending secret (encrypted); it only becomes active on /enroll/verify.
  await s.model.update({
    where: { id: s.row.id },
    data: { totp_secret: encrypt(secret), totp_enabled: false },
  });

  const qr = await qrcode.toDataURL(otpauth, { margin: 1, width: 240 });
  res.json({ secret, otpauth_url: otpauth, qr });
});

// ── POST /enroll/verify ─────────────────────────────────────────────────────
router.post('/enroll/verify',
  // authLimiter, // SECURITY DISABLED (temporary) — uncomment to re-enable rate limiting
  guardConfigured,
  body('code').isString().trim().matches(/^\d{6}$/),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ error: 'Enter the 6-digit code from your authenticator app.' });

    const sub = req.principal;
    const s = await loadSubject(sub);
    if (!s) return res.status(404).json({ error: 'Account not found' });
    if (s.twoFactor.enabled) return res.status(409).json({ error: 'Two-factor is already enabled.' });
    if (!s.row.totp_secret) return res.status(400).json({ error: 'Start enrolment first.' });

    const ok = await totp.verifyToken(req.body.code, decrypt(s.row.totp_secret));
    if (!ok) return res.status(401).json({ error: 'Incorrect code. Check your device clock and try again.' });

    const { plain, stored } = totp.generateRecoveryCodes(10);
    await s.model.update({
      where: { id: s.row.id },
      data: { totp_enabled: true, totp_enrolled_at: new Date(), recovery_codes: stored },
    });

    // Invalidate anything issued before 2FA was on, then re-issue for this caller.
    await killAllSessions({ subjectType: sub.subjectType, subjectId: sub.subjectId, schoolId: sub.schoolId, model: s.model });
    const session = await newSessionFor(req, res, sub);
    res.json({ enabled: true, recovery_codes: plain, ...session });
  }
);

// ── POST /disable ───────────────────────────────────────────────────────────
router.post('/disable',
  // authLimiter, // SECURITY DISABLED (temporary) — uncomment to re-enable rate limiting
  requireFull,
  guardConfigured,
  body('code').isString().trim().notEmpty(),
  async (req, res) => {
    const sub = req.principal;
    const s = await loadSubject(sub);
    if (!s) return res.status(404).json({ error: 'Account not found' });
    if (!s.twoFactor.enabled) return res.status(409).json({ error: 'Two-factor is not enabled.' });
    if (s.twoFactor.mandatory) return res.status(403).json({ error: 'Two-factor is required for this role and cannot be disabled.' });

    const code = String(req.body.code).trim();
    let ok = /^\d{6}$/.test(code) && await totp.verifyToken(code, decrypt(s.row.totp_secret));
    if (!ok && totp.consumeRecoveryCode(code, s.row.recovery_codes)) ok = true;
    if (!ok) return res.status(401).json({ error: 'Incorrect code.' });

    await s.model.update({
      where: { id: s.row.id },
      data: { totp_enabled: false, totp_secret: null, totp_enrolled_at: null, recovery_codes: null },
    });
    await killAllSessions({ subjectType: sub.subjectType, subjectId: sub.subjectId, schoolId: sub.schoolId, model: s.model });
    const session = await newSessionFor(req, res, sub);
    res.json({ enabled: false, ...session });
  }
);

// ── POST /recovery/regenerate ───────────────────────────────────────────────
router.post('/recovery/regenerate',
  // authLimiter, // SECURITY DISABLED (temporary) — uncomment to re-enable rate limiting
  requireFull,
  guardConfigured,
  body('code').isString().trim().matches(/^\d{6}$/),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ error: 'Enter your current 6-digit code.' });

    const sub = req.principal;
    const s = await loadSubject(sub);
    if (!s || !s.twoFactor.enabled) return res.status(409).json({ error: 'Two-factor is not enabled.' });

    const ok = await totp.verifyToken(req.body.code, decrypt(s.row.totp_secret));
    if (!ok) return res.status(401).json({ error: 'Incorrect code.' });

    const { plain, stored } = totp.generateRecoveryCodes(10);
    await s.model.update({ where: { id: s.row.id }, data: { recovery_codes: stored } });
    res.json({ recovery_codes: plain });
  }
);

module.exports = router;
