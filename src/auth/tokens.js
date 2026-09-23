/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Access + refresh token lifecycle.
//
//   • Access token  — short-lived JWT (env.ACCESS_TOKEN_TTL). Carries `jti`,
//     `tv` (the subject's token_version at mint time) and `scope`.
//   • Refresh token — opaque 256-bit random string. Only its sha-256 hash is
//     stored (platform DB, `auth_refresh_tokens`). Rotated on every use;
//     replay of an already-rotated token revokes the whole family.
//
// A subject is identified by (subject_type, subject_id[, school_id]):
//   platform admin  → ('platform', adminId)
//   tenant user     → ('tenant',  userId, schoolId)

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');

const env = require('../config/env');
const platformClient = require('../db/platformClient');
const tenantPool = require('../db/tenantPool');
const { MANDATORY_2FA_ROLES, SCHOOL_ADMIN_ROLES } = require('./roles');

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const ttlSeconds = () => {
  // jsonwebtoken accepts "15m"/"3600"/number — normalise to seconds for the client.
  const t = env.ACCESS_TOKEN_TTL;
  if (typeof t === 'number') return t;
  const m = /^(\d+)\s*([smhd])?$/.exec(String(t).trim());
  if (!m) return 900;
  const n = Number(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 's']);
};

// ── Claims ──────────────────────────────────────────────────────────────────
function buildClaims(subjectType, row, schoolId) {
  if (subjectType === 'platform') {
    return {
      id: row.id, email: row.email, role: row.role,
      name: row.name, initials: row.initials, scope: 'platform',
    };
  }
  return {
    id: row.id, email: row.email, role: row.role,
    name: row.name, initials: row.initials,
    teacher_id: row.teacher_id || null,
    student_id: row.student_id || null,
    parent_id: row.parent_id || null,
    school_id: schoolId,
    scope: 'tenant',
    must_change_password: !!row.must_change_password,
  };
}

// ── Subject loading ─────────────────────────────────────────────────────────
/**
 * @returns {Promise<null | {
 *   row: object, model: object, claims: object, tokenVersion: number,
 *   twoFactor: { enabled: boolean, mandatory: boolean }
 * }>}
 */
async function loadSubject({ subjectType, subjectId, schoolId }) {
  if (subjectType === 'platform') {
    const row = await platformClient.platformAdmin.findUnique({ where: { id: subjectId } });
    if (!row) return null;
    return {
      row,
      model: platformClient.platformAdmin,
      claims: buildClaims('platform', row),
      tokenVersion: row.token_version || 0,
      twoFactor: { enabled: !!row.totp_enabled, mandatory: MANDATORY_2FA_ROLES.has(row.role) },
    };
  }

  const school = await platformClient.school.findUnique({
    where: { id: schoolId }, select: { status: true },
  });
  if (!school || school.status !== 'active') return null;

  const db = tenantPool.getOrOpen(schoolId);
  const row = await db.user.findUnique({ where: { id: subjectId } });
  if (!row) return null;

  let mandatory = false;
  if (SCHOOL_ADMIN_ROLES.has(row.role)) {
    const s = await db.school.findFirst({ select: { require_admin_2fa: true } });
    mandatory = !!(s && s.require_admin_2fa);
  }

  return {
    row,
    model: db.user,
    claims: buildClaims('tenant', row, schoolId),
    tokenVersion: row.token_version || 0,
    twoFactor: { enabled: !!row.totp_enabled, mandatory },
  };
}

// ── Issue ───────────────────────────────────────────────────────────────────
function signAccess(claims, tokenVersion) {
  return jwt.sign(
    { ...claims, jti: uuid(), tv: tokenVersion },
    env.JWT_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL },
  );
}

async function issueTokenPair({ subjectType, subjectId, schoolId, claims, tokenVersion, req, familyId }) {
  const rawRefresh = crypto.randomBytes(32).toString('base64url');
  const id = uuid();
  const family = familyId || uuid();

  await platformClient.authRefreshToken.create({
    data: {
      id,
      subject_type: subjectType,
      subject_id: subjectId,
      school_id: schoolId || null,
      family_id: family,
      token_hash: sha256(rawRefresh),
      user_agent: (req && String(req.headers['user-agent'] || '').slice(0, 400)) || null,
      ip: (req && (req.ip || req.socket?.remoteAddress)) || null,
      expires_at: new Date(Date.now() + env.REFRESH_TOKEN_TTL_MS),
    },
  });

  return {
    accessToken: signAccess(claims, tokenVersion),
    refreshToken: rawRefresh,
    expiresIn: ttlSeconds(),
    tokenId: id,
    familyId: family,
  };
}

// ── Rotate ──────────────────────────────────────────────────────────────────
async function rotateRefreshToken(rawToken, req) {
  if (!rawToken) { const e = new Error('Missing refresh token'); e.status = 401; e.code = 'refresh_missing'; throw e; }

  const record = await platformClient.authRefreshToken.findUnique({ where: { token_hash: sha256(rawToken) } });
  if (!record) { const e = new Error('Session expired. Please sign in again.'); e.status = 401; e.code = 'refresh_invalid'; throw e; }

  if (record.revoked_at) {
    // This token was already rotated away — its presentation means it leaked.
    await revokeFamily(record.family_id);
    const e = new Error('Session revoked. Please sign in again.');
    e.status = 401; e.code = 'refresh_reuse';
    throw e;
  }
  if (record.expires_at.getTime() < Date.now()) {
    const e = new Error('Session expired. Please sign in again.');
    e.status = 401; e.code = 'refresh_expired';
    throw e;
  }

  const subject = await loadSubject({
    subjectType: record.subject_type,
    subjectId: record.subject_id,
    schoolId: record.school_id,
  });
  if (!subject) {
    await revokeFamily(record.family_id);
    const e = new Error('Account is no longer active.');
    e.status = 401; e.code = 'subject_inactive';
    throw e;
  }

  const next = await issueTokenPair({
    subjectType: record.subject_type,
    subjectId: record.subject_id,
    schoolId: record.school_id,
    claims: subject.claims,
    tokenVersion: subject.tokenVersion,
    req,
    familyId: record.family_id,
  });

  await platformClient.authRefreshToken.update({
    where: { id: record.id },
    data: { revoked_at: new Date(), replaced_by_id: next.tokenId, last_used_at: new Date() },
  });

  return { ...next, user: subject.claims };
}

// ── Revoke ──────────────────────────────────────────────────────────────────
async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  await platformClient.authRefreshToken.updateMany({
    where: { token_hash: sha256(rawToken), revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

async function revokeFamily(familyId) {
  await platformClient.authRefreshToken.updateMany({
    where: { family_id: familyId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

async function revokeAllForSubject(subjectType, subjectId) {
  await platformClient.authRefreshToken.updateMany({
    where: { subject_type: subjectType, subject_id: subjectId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

async function revokeAllForSchool(schoolId) {
  await platformClient.authRefreshToken.updateMany({
    where: { school_id: schoolId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

// ── token_version kill-switch ───────────────────────────────────────────────
async function bumpTokenVersion({ subjectType, subjectId, schoolId, model }) {
  const m = model || (subjectType === 'platform'
    ? platformClient.platformAdmin
    : tenantPool.getOrOpen(schoolId).user);
  await m.update({ where: { id: subjectId }, data: { token_version: { increment: 1 } } });
}

/** Bump token_version AND revoke every refresh token — a full "log this subject out everywhere". */
async function killAllSessions({ subjectType, subjectId, schoolId, model }) {
  await bumpTokenVersion({ subjectType, subjectId, schoolId, model });
  await revokeAllForSubject(subjectType, subjectId);
}

module.exports = {
  MANDATORY_2FA_ROLES,
  SCHOOL_ADMIN_ROLES,
  buildClaims,
  loadSubject,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeFamily,
  revokeAllForSubject,
  revokeAllForSchool,
  bumpTokenVersion,
  killAllSessions,
  ttlSeconds,
};
