/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const platformClient = require('../db/platformClient');
const tenantPool = require('../db/tenantPool');
const authenticate = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const lockout = require('../auth/lockout');
const totp = require('../auth/totp');
const {
  loadSubject, issueTokenPair, rotateRefreshToken, revokeRefreshToken, killAllSessions,
} = require('../auth/tokens');
const { signPurposeToken, verifyPurposeToken } = require('../auth/mfaTokens');
const { readRefreshCookie, setRefreshCookie, clearRefreshCookie } = require('../auth/cookies');

function directoryEmailForStudentNumber(studentNumber) {
  return `${studentNumber.trim().toLowerCase().replace(/-/g, '')}@school.local`;
}

// Generic, timing-stable-ish rejection so we never disclose which accounts exist.
function invalidCredentials(res) {
  return res.status(401).json({ error: 'Invalid email or password' });
}

function respondWithSession(res, pair, user) {
  setRefreshCookie(res, pair.refreshToken);
  res.json({
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    user,
  });
}

// Decides what happens after a correct password: straight in, 2FA challenge,
// or forced 2FA enrolment.
async function completeLogin(res, req, { subjectType, subjectId, schoolId }) {
  const subject = await loadSubject({ subjectType, subjectId, schoolId });
  if (!subject) return invalidCredentials(res);

  const { twoFactor } = subject; // eslint-disable-line no-unused-vars

  // ─── SECURITY DISABLED (temporary) — two-factor login enforcement ──────────
  // Uncomment to re-require a 2FA code / forced enrolment on login.
  // if (twoFactor.enabled) {
  //   return res.json({
  //     mfa_required: true,
  //     mfa_token: signPurposeToken('mfa', { subjectType, subjectId, schoolId }, '5m'),
  //   });
  // }
  //
  // if (twoFactor.mandatory) {
  //   return res.json({
  //     mfa_enroll_required: true,
  //     enroll_token: signPurposeToken('enroll', { subjectType, subjectId, schoolId }, '20m'),
  //   });
  // }
  // ─── end disabled block ─────────────────────────────────────────────────────

  const pair = await issueTokenPair({
    subjectType, subjectId, schoolId,
    claims: subject.claims, tokenVersion: subject.tokenVersion, req,
  });
  return respondWithSession(res, pair, subject.claims);
}

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login',
  // authLimiter, // SECURITY DISABLED (temporary) — uncomment to re-enable login rate limiting
  body('email').isString().trim().notEmpty(),
  body('password').optional().isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const identifier = req.body.email;
    const password = req.body.password || '';
    const isEmailLogin = identifier.includes('@');
    if (isEmailLogin && !password) {
      return res.status(422).json({ error: 'Password required for email login' });
    }

    const lookupEmail = isEmailLogin ? identifier : directoryEmailForStudentNumber(identifier);

    // ── Platform admin? ──
    const platformAdmin = await platformClient.platformAdmin.findFirst({
      where: { email: { equals: lookupEmail, mode: 'insensitive' } },
    });
    if (platformAdmin) {
      // ─── SECURITY DISABLED (temporary) — account lockout ───────────────────
      // try { lockout.assertNotLocked(platformAdmin); }
      // catch (e) { return res.status(e.status).set('Retry-After', String(e.retryAfterSeconds)).json({ error: e.message }); }

      if (!bcrypt.compareSync(password, platformAdmin.password_hash)) {
        // await lockout.registerFailure(platformClient.platformAdmin, platformAdmin);
        return invalidCredentials(res);
      }
      // await lockout.registerSuccess(platformClient.platformAdmin, platformAdmin);
      // ─── end disabled block ─────────────────────────────────────────────────
      return completeLogin(res, req, { subjectType: 'platform', subjectId: platformAdmin.id, schoolId: null });
    }

    // ── Tenant user (via cross-tenant directory) ──
    const dirEntry = await platformClient.userDirectory.findFirst({
      where: { email: { equals: lookupEmail, mode: 'insensitive' } },
    });
    if (!dirEntry) return invalidCredentials(res);

    const school = await platformClient.school.findUnique({
      where: { id: dirEntry.school_id }, select: { status: true },
    });
    if (!school || school.status !== 'active') {
      return res.status(403).json({ error: 'School account is not active' });
    }

    const tenantDb = tenantPool.getOrOpen(dirEntry.school_id);
    const user = await tenantDb.user.findFirst({
      where: { email: { equals: lookupEmail, mode: 'insensitive' } },
    });
    if (!user) return invalidCredentials(res);

    // ─── SECURITY DISABLED (temporary) — account lockout ─────────────────────
    // try { lockout.assertNotLocked(user); }
    // catch (e) { return res.status(e.status).set('Retry-After', String(e.retryAfterSeconds)).json({ error: e.message }); }

    const badPassword = isEmailLogin
      ? !bcrypt.compareSync(password, user.password_hash)
      : user.role !== 'student';
    if (badPassword) {
      // await lockout.registerFailure(tenantDb.user, user);
      return invalidCredentials(res);
    }

    if (!isEmailLogin) {
      const student = await tenantDb.student.findFirst({
        where: { student_number: { equals: identifier, mode: 'insensitive' } },
        select: { id: true, is_active: true },
      });
      if (!student || !student.is_active || user.student_id !== student.id) {
        // await lockout.registerFailure(tenantDb.user, user);
        return invalidCredentials(res);
      }
    }

    // await lockout.registerSuccess(tenantDb.user, user);
    // ─── end disabled block ───────────────────────────────────────────────────
    return completeLogin(res, req, { subjectType: 'tenant', subjectId: user.id, schoolId: dirEntry.school_id });
  }
);

// ── POST /api/auth/login/2fa ────────────────────────────────────────────────
router.post('/login/2fa',
  // authLimiter, // SECURITY DISABLED (temporary) — uncomment to re-enable rate limiting
  body('mfa_token').isString().notEmpty(),
  body('code').isString().trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    let sub;
    try { sub = verifyPurposeToken(req.body.mfa_token, 'mfa'); }
    catch (e) { return res.status(e.status || 401).json({ error: e.message, code: e.code }); }

    const subject = await loadSubject(sub);
    if (!subject || !subject.twoFactor.enabled) {
      return res.status(401).json({ error: 'Two-factor is not set up for this account.' });
    }

    // ─── SECURITY DISABLED (temporary) — account lockout ─────────────────────
    // try { lockout.assertNotLocked(subject.row); }
    // catch (e) { return res.status(e.status).set('Retry-After', String(e.retryAfterSeconds)).json({ error: e.message }); }
    // ─── end disabled block ───────────────────────────────────────────────────

    const code = String(req.body.code).trim();
    let ok = false;

    // TOTP first, then fall back to a recovery code.
    if (/^\d{6}$/.test(code)) {
      const { decrypt } = require('../auth/crypto');
      try { ok = await totp.verifyToken(code, decrypt(subject.row.totp_secret)); }
      catch { ok = false; }
    }
    if (!ok) {
      const consumed = totp.consumeRecoveryCode(code, subject.row.recovery_codes);
      if (consumed) {
        ok = true;
        await subject.model.update({ where: { id: subject.row.id }, data: { recovery_codes: consumed } });
      }
    }

    if (!ok) {
      // await lockout.registerFailure(subject.model, subject.row); // SECURITY DISABLED (temporary)
      return res.status(401).json({ error: 'Incorrect code.' });
    }

    // await lockout.registerSuccess(subject.model, subject.row); // SECURITY DISABLED (temporary)
    const fresh = await loadSubject(sub); // re-read: recovery_codes may have changed
    const pair = await issueTokenPair({
      subjectType: sub.subjectType, subjectId: sub.subjectId, schoolId: sub.schoolId,
      claims: fresh.claims, tokenVersion: fresh.tokenVersion, req,
    });
    return respondWithSession(res, pair, fresh.claims);
  }
);

// ── POST /api/auth/refresh ──────────────────────────────────────────────────
router.post('/refresh', /* authLimiter, */ async (req, res) => { // SECURITY DISABLED (temporary)
  const raw = req.body?.refreshToken || readRefreshCookie(req);
  try {
    const next = await rotateRefreshToken(raw, req);
    setRefreshCookie(res, next.refreshToken);
    res.json({
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresIn: next.expiresIn,
      user: next.user,
    });
  } catch (e) {
    clearRefreshCookie(res);
    res.status(e.status || 401).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  }
});

// ── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const raw = req.body?.refreshToken || readRefreshCookie(req);
  await revokeRefreshToken(raw).catch(() => {});
  clearRefreshCookie(res);
  res.json({ message: 'Logged out' });
});

// ── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = await req.db.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, name: true, email: true, role: true, initials: true,
      teacher_id: true, student_id: true, parent_id: true,
      must_change_password: true, totp_enabled: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ── PUT /api/auth/me/password ───────────────────────────────────────────────
router.put('/me/password',
  authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const user = await req.db.user.findUnique({ where: { id: req.user.id } });
    if (!bcrypt.compareSync(req.body.currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    await req.db.user.update({
      where: { id: req.user.id },
      data: {
        password_hash: bcrypt.hashSync(req.body.newPassword, 10),
        must_change_password: false,
        updated_at: new Date(),
      },
    });

    // Every existing session (this device included) is now stale — kill them all,
    // then hand this caller a brand-new pair so they stay signed in.
    await killAllSessions({
      subjectType: 'tenant', subjectId: req.user.id,
      schoolId: req.user.school_id, model: req.db.user,
    });
    const subject = await loadSubject({
      subjectType: 'tenant', subjectId: req.user.id, schoolId: req.user.school_id,
    });
    const pair = await issueTokenPair({
      subjectType: 'tenant', subjectId: req.user.id, schoolId: req.user.school_id,
      claims: subject.claims, tokenVersion: subject.tokenVersion, req,
    });
    setRefreshCookie(res, pair.refreshToken);
    res.json({
      message: 'Password updated',
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresIn: pair.expiresIn,
      user: subject.claims,
    });
  }
);

module.exports = router;
