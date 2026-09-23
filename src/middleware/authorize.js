/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
module.exports = function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.scope === 'platform') return res.status(403).json({ error: 'Forbidden' });
    // head_teacher is a legacy alias for super_admin
    const role = req.user.role === 'head_teacher' ? 'super_admin' : req.user.role;
    if (!roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
};
