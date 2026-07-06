module.exports = function authorizePlatform(...roles) {
  return (req, res, next) => {
    if (!req.user || req.user.scope !== 'platform') return res.status(403).json({ error: 'Forbidden' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
};
