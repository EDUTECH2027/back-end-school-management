/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
module.exports = function authorizePlatform(...roles) {
  return (req, res, next) => {
    if (!req.user || req.user.scope !== 'platform') return res.status(403).json({ error: 'Forbidden' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
};
