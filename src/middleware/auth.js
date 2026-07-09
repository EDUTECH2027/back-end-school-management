const jwt = require('jsonwebtoken');
const platformClient = require('../db/platformClient');
const tenantPool = require('../db/tenantPool');

module.exports = async function authenticate(req, res, next) {
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
