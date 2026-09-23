/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Blocks the API when the license has hard-failed (only mounted when
// LICENSE_REQUIRED=true). Health and the license-status endpoint stay open so
// operators can still see what's wrong.

const env = require('../config/env');
const { getStatus } = require('./state');

const OPEN_PATHS = new Set(['/api/health', '/api/license/status']);

module.exports = function licenseGate(req, res, next) {
  if (!env.LICENSE_REQUIRED) return next();
  if (OPEN_PATHS.has(req.path)) return next();

  const status = getStatus();
  if (status.valid || status.inGrace) return next();

  res.status(402).json({
    error: 'This installation is not licensed. Contact your vendor.',
    code: 'license_invalid',
    reason: status.reason,
  });
};
