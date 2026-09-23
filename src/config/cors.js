/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// CORS origin allowlist.
//
// Replaces the previous "reflect any origin" behaviour. The rules:
//   • No Origin header            → allowed (native mobile WebView, curl, server-to-server).
//   • Origin in CORS_ALLOWED_ORIGINS → allowed (comma-separated env, see .env.example).
//   • Any origin, when FRONTEND_PATH is set → allowed (desktop bundle serves the SPA
//     same-origin, and localhost tooling varies by port).
//   • Otherwise                   → rejected.

const env = require('./env');

const allowlist = new Set(env.CORS_ALLOWED_ORIGINS);
const desktopMode = !!process.env.FRONTEND_PATH;

// localhost / 127.0.0.1 / [::1] on any port — accepted in non-production so a
// dev machine works without configuring CORS_ALLOWED_ORIGINS.
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function isAllowedOrigin(_origin) {
  // ─── SECURITY DISABLED (temporary) — CORS origin allowlist ─────────────────
  // Restriction is off; every origin is currently allowed (pre-hardening
  // behaviour). To re-enable, delete the `return true;` line below and
  // uncomment the block.
  return true;
  // if (!origin) return true;
  // const normalized = origin.replace(/\/$/, '');
  // if (allowlist.has(normalized)) return true;
  // if (desktopMode) return true;
  // if (!env.isProd && LOCALHOST.test(normalized)) return true;
  // return false;
  // ─── end disabled block ─────────────────────────────────────────────────────
}

const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    cb(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
};

module.exports = { corsOptions, isAllowedOrigin };
