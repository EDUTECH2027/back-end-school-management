/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Rate limiters (express-rate-limit).
//
// Store is the default in-memory one: correct for a single process. If this API
// is ever run multi-instance, swap in a shared store (e.g. rate-limit-redis)
// here — the limiter definitions below don't otherwise change.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Broad limiter for the whole API surface — catches scrapers / runaway clients
// without getting in the way of a normal session.
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: req => req.path === '/health' || req.path === '/license/status',
  message: { error: 'Too many requests — slow down and try again shortly.' },
});

// Tight limiter for credential endpoints. Keyed on IP *and* the submitted
// identifier so one noisy IP behind a NAT can't lock out everyone, and a
// single targeted account can't be hammered from rotating IPs unchecked.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: req => {
    const ip = ipKeyGenerator(req.ip);
    const id = String(req.body?.email || req.body?.mfa_token || '').toLowerCase().slice(0, 120);
    return `${ip}:${id}`;
  },
  message: { error: 'Too many attempts. Wait a few minutes before trying again.' },
});

module.exports = { apiLimiter, authLimiter };
