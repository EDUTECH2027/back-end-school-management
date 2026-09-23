/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Optional httpOnly refresh-token cookie support (USE_AUTH_COOKIES=true).
// Off by default: the shipped web client and the Capacitor WebView both keep
// the refresh token in the response body. See docs/SECURITY_HARDENING.md.

const env = require('../config/env');

const REFRESH_COOKIE = 'edutech_rt';
const COOKIE_PATH = '/api/auth';

function readRefreshCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === REFRESH_COOKIE) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setRefreshCookie(res, token) {
  if (!env.USE_AUTH_COOKIES) return;
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: env.REFRESH_TOKEN_TTL_MS,
    path: COOKIE_PATH,
  });
}

function clearRefreshCookie(res) {
  if (!env.USE_AUTH_COOKIES) return;
  res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
}

module.exports = { REFRESH_COOKIE, readRefreshCookie, setRefreshCookie, clearRefreshCookie };
