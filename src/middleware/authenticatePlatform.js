const jwt = require('jsonwebtoken');

module.exports = function authenticatePlatform(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'dev_secret');
    if (payload.scope !== 'platform') return res.status(403).json({ error: 'Forbidden' });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
};
