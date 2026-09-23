/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const env = require('../config/env');

module.exports = function errorHandler(err, req, res, _next) {
  const isCors = /not allowed by CORS/i.test(err.message || '');
  const status = isCors ? 403 : (err.status || err.statusCode || 500);

  // Only log full detail for real server faults; expected 4xx (validation,
  // lockout, auth, CORS) are noise.
  if (status >= 500) console.error(err);
  else if (!env.isProd) console.warn(`[${status}] ${req.method} ${req.originalUrl}: ${err.message}`);

  if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));

  const message = isCors
    ? 'Origin not allowed'
    : (status >= 500 && env.isProd ? 'Internal server error' : err.message || 'Internal server error');

  res.status(status).json({
    error: message,
    ...(err.code ? { code: err.code } : {}),
  });
};
