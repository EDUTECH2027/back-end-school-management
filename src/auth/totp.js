/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Thin wrapper around otplib (v13, promise-based) so the version-specific API
// lives in one place, plus recovery-code helpers.

const crypto = require('crypto');
const otplib = require('otplib');

const ISSUER = process.env.TOTP_ISSUER || 'EduTech';

function generateSecret() {
  return otplib.generateSecret(); // base32 string
}

function keyUri(accountLabel, secret) {
  return otplib.generateURI({ issuer: ISSUER, label: accountLabel, secret });
}

async function verifyToken(token, secret) {
  const t = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  try {
    const res = await otplib.verify({ token: t, secret, window: 1 });
    return !!(res && res.valid);
  } catch {
    return false;
  }
}

// ── Recovery codes ──────────────────────────────────────────────────────────
function normalizeRecovery(code) {
  return String(code || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function hashRecovery(code) {
  return crypto.createHash('sha256').update(normalizeRecovery(code)).digest('hex');
}

/** Returns { plain: string[], stored: [{ hash, used_at:null }] }. */
function generateRecoveryCodes(count = 10) {
  const plain = [];
  const stored = [];
  for (let i = 0; i < count; i++) {
    const hex = crypto.randomBytes(9).toString('hex').toUpperCase();
    const code = `${hex.slice(0, 6)}-${hex.slice(6, 12)}-${hex.slice(12, 18)}`;
    plain.push(code);
    stored.push({ hash: hashRecovery(code), used_at: null });
  }
  return { plain, stored };
}

/**
 * Checks a candidate recovery code against a stored list.
 * Returns the updated list (with the matched entry consumed) or null if no match.
 */
function consumeRecoveryCode(candidate, storedList) {
  const list = Array.isArray(storedList) ? storedList : [];
  const target = hashRecovery(candidate);
  let matched = false;
  const next = list.map(entry => {
    if (!matched && entry && entry.hash === target && !entry.used_at) {
      matched = true;
      return { ...entry, used_at: new Date().toISOString() };
    }
    return entry;
  });
  return matched ? next : null;
}

function countUnusedRecovery(storedList) {
  return (Array.isArray(storedList) ? storedList : []).filter(e => e && !e.used_at).length;
}

module.exports = {
  ISSUER,
  generateSecret,
  keyUri,
  verifyToken,
  generateRecoveryCodes,
  consumeRecoveryCode,
  countUnusedRecovery,
  hashRecovery,
};
