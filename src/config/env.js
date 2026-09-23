/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Central, validated environment configuration.
//
// Every other module reads auth/security settings from here instead of touching
// process.env directly, so the rules (and the "refuse to boot on a weak secret"
// guard) live in exactly one place. Requiring this file has side effects: it
// validates on load and throws — that is deliberate, so a misconfigured
// deployment fails fast at startup rather than silently running insecurely.

const crypto = require('crypto');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const allowWeak = process.env.ALLOW_WEAK_SECRETS === 'true';

const problems = [];
const warnings = [];

// ── JWT signing secret ──────────────────────────────────────────────────────
// Must be strong in production. In development a missing/weak secret is tolerated
// only with ALLOW_WEAK_SECRETS=true, and we substitute an ephemeral random one
// (so tokens simply don't survive a restart — fine for local work).
let JWT_SECRET = process.env.JWT_SECRET || '';
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'dev_secret',
  'change_this_to_a_long_random_secret_string',
  'your-secret-key',
  'secret',
]);
const secretIsWeak = !JWT_SECRET || KNOWN_PLACEHOLDER_SECRETS.has(JWT_SECRET) || JWT_SECRET.length < 32;
if (secretIsWeak) {
  if (isProd || !allowWeak) {
    problems.push(
      'JWT_SECRET is missing or weak. Set JWT_SECRET to a random string of at ' +
      'least 32 characters (e.g. `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"`). ' +
      'For local development only you may set ALLOW_WEAK_SECRETS=true.'
    );
  } else {
    JWT_SECRET = crypto.randomBytes(48).toString('base64');
    warnings.push('JWT_SECRET is weak/missing — using an ephemeral random secret for this process (dev only).');
  }
}

// ── TOTP secret-at-rest encryption key (AES-256-GCM, 32 bytes base64) ────────
let TOTP_ENC_KEY_RAW = process.env.TOTP_ENC_KEY || '';
let TOTP_ENC_KEY = null;
if (TOTP_ENC_KEY_RAW) {
  try {
    const buf = Buffer.from(TOTP_ENC_KEY_RAW, 'base64');
    if (buf.length !== 32) throw new Error('must decode to exactly 32 bytes');
    TOTP_ENC_KEY = buf;
  } catch (e) {
    problems.push(`TOTP_ENC_KEY is invalid (${e.message}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  }
} else if (isProd) {
  problems.push(
    'TOTP_ENC_KEY is missing. It encrypts two-factor secrets at rest. Generate one with: ' +
    'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
  );
} else {
  // Dev fallback: deterministically derive a key from the JWT secret. Two-factor
  // secrets encrypted with this key won't decrypt in production — that's fine,
  // dev accounts re-enrol.
  TOTP_ENC_KEY = crypto.createHash('sha256').update('totp:' + JWT_SECRET).digest();
  warnings.push('TOTP_ENC_KEY is not set — deriving a development key from JWT_SECRET. Set TOTP_ENC_KEY before production.');
}

// ── Token lifetimes ─────────────────────────────────────────────────────────
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_DAYS = intFromEnv('REFRESH_TOKEN_TTL_DAYS', 30, 1, 365);
const MFA_TOKEN_TTL = process.env.MFA_TOKEN_TTL || '5m';

// ── Login throttling / lockout ──────────────────────────────────────────────
const LOGIN_MAX_ATTEMPTS = intFromEnv('LOGIN_MAX_ATTEMPTS', 5, 3, 50);
const LOGIN_LOCK_MINUTES = intFromEnv('LOGIN_LOCK_MINUTES', 15, 1, 1440);
const LOGIN_ATTEMPT_WINDOW_MINUTES = intFromEnv('LOGIN_ATTEMPT_WINDOW_MINUTES', 15, 1, 1440);

// ── CORS ────────────────────────────────────────────────────────────────────
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

const USE_AUTH_COOKIES = process.env.USE_AUTH_COOKIES === 'true';

// ── On-prem licensing (all dormant unless LICENSE_REQUIRED=true) ─────────────
const LICENSE_REQUIRED = process.env.LICENSE_REQUIRED === 'true';
const LICENSE_FILE = process.env.LICENSE_FILE || './license.lic';
const LICENSE_PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || '';
const LICENSE_SERVER_URL = (process.env.LICENSE_SERVER_URL || '').replace(/\/$/, '');
const LICENSE_GRACE_DAYS = intFromEnv('LICENSE_GRACE_DAYS', 14, 0, 365);
const LICENSE_STATE_FILE = process.env.LICENSE_STATE_FILE || './license-state.json';
const LICENSE_PHONE_HOME_HOURS = intFromEnv('LICENSE_PHONE_HOME_HOURS', 12, 1, 720);

if (LICENSE_REQUIRED && !LICENSE_PUBLIC_KEY) {
  problems.push('LICENSE_REQUIRED=true but LICENSE_PUBLIC_KEY is not set. Bake in the Ed25519 public key (base64 SPKI) for this build.');
}

// ── Report & fail fast ──────────────────────────────────────────────────────
for (const w of warnings) console.warn(`[env] WARNING: ${w}`);
if (problems.length) {
  console.error('\n[env] Refusing to start — configuration problems:\n' + problems.map(p => `  • ${p}`).join('\n') + '\n');
  throw new Error('Invalid environment configuration');
}

function intFromEnv(name, def, min, max) {
  const raw = process.env[name];
  if (raw == null || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    warnings.push(`${name}="${raw}" is out of range [${min}, ${max}] — using default ${def}.`);
    return def;
  }
  return n;
}

module.exports = Object.freeze({
  NODE_ENV,
  isProd,
  JWT_SECRET,
  TOTP_ENC_KEY,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
  REFRESH_TOKEN_TTL_MS: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  MFA_TOKEN_TTL,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCK_MINUTES,
  LOGIN_ATTEMPT_WINDOW_MINUTES,
  CORS_ALLOWED_ORIGINS,
  USE_AUTH_COOKIES,
  LICENSE_REQUIRED,
  LICENSE_FILE,
  LICENSE_PUBLIC_KEY,
  LICENSE_SERVER_URL,
  LICENSE_GRACE_DAYS,
  LICENSE_STATE_FILE,
  LICENSE_PHONE_HOME_HOURS,
});
