/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const platformClient = require('../db/platformClient');
const tenantPool = require('../db/tenantPool');
const { verifyAccess } = require('../auth/verify');

module.exports = async function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  let payload;
  try {
    payload = await verifyAccess(header.slice(7), 'tenant');
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  }

  const school = await platformClient.school.findUnique({
    where: { id: payload.school_id },
    select: { status: true },
  });
  if (!school) return res.status(404).json({ error: 'School not found' });
  if (school.status !== 'active') return res.status(403).json({ error: 'School account is not active' });

  req.user = payload;
  req.db = tenantPool.getOrOpen(payload.school_id);
  next();
};
