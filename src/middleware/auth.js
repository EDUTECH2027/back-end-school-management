const jwt = require('jsonwebtoken');
const { ALS } = require('../db/tenantContext');
const platformDb = require('../db/platform');

module.exports = function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }

  // Platform-scoped tokens never authenticate against tenant-scoped routes.
  if (payload.scope === 'platform') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const school = platformDb.prepare('SELECT status FROM schools WHERE id = ?').get(payload.school_id);
  if (!school) return res.status(404).json({ error: 'School not found' });
  if (school.status !== 'active') return res.status(403).json({ error: 'School account is not active' });

  req.user = payload;
  ALS.run({ schoolId: payload.school_id }, next);
};
