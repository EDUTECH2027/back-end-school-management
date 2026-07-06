const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const platformDb = require('../db/platform');
const { runWithTenant } = require('../db/tenantContext');
const authenticate = require('../middleware/auth');

const SECRET = () => process.env.JWT_SECRET || 'dev_secret';
const EXPIRES = () => process.env.JWT_EXPIRES_IN || '24h';

// POST /api/auth/login
// Checks platform admins first, then routes to the correct tenant DB via the
// cross-tenant email -> school_id directory (see db/platformSchema.js).
router.post('/login',
  // Note: no .normalizeEmail() here — it lowercases *and* strips gmail dots/subaddresses,
  // which would silently diverge from whatever case the email was stored in at write time.
  // Lookups below use COLLATE NOCASE instead, so login is case-insensitive without mutating input.
  body('email').isEmail().trim(),
  body('password').notEmpty(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password } = req.body;

    const platformAdmin = platformDb.prepare('SELECT * FROM platform_admins WHERE email = ? COLLATE NOCASE').get(email);
    if (platformAdmin) {
      if (!bcrypt.compareSync(password, platformAdmin.password_hash)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const payload = {
        id: platformAdmin.id, email: platformAdmin.email, role: platformAdmin.role,
        name: platformAdmin.name, initials: platformAdmin.initials, scope: 'platform',
      };
      const token = jwt.sign(payload, SECRET(), { expiresIn: EXPIRES() });
      return res.json({ token, user: payload });
    }

    const dirEntry = platformDb.prepare('SELECT school_id FROM user_directory WHERE email = ? COLLATE NOCASE').get(email);
    if (!dirEntry) return res.status(401).json({ error: 'Invalid email or password' });

    const school = platformDb.prepare('SELECT status FROM schools WHERE id = ?').get(dirEntry.school_id);
    if (!school || school.status !== 'active') return res.status(403).json({ error: 'School account is not active' });

    runWithTenant(dirEntry.school_id, () => {
      const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const payload = {
        id: user.id, email: user.email, role: user.role, name: user.name,
        initials: user.initials,
        teacher_id: user.teacher_id || null,
        student_id: user.student_id || null,
        parent_id:  user.parent_id  || null,
        school_id: dirEntry.school_id,
        scope: 'tenant',
        must_change_password: !!user.must_change_password,
      };
      const token = jwt.sign(payload, SECRET(), { expiresIn: EXPIRES() });
      res.json({ token, user: payload });
    });
  }
);

// POST /api/auth/logout  (stateless — client discards token)
router.post('/logout', (_req, res) => res.json({ message: 'Logged out' }));

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id,name,email,role,initials,teacher_id,student_id,parent_id,must_change_password FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, must_change_password: !!user.must_change_password });
});

// PUT /api/auth/me/password
router.put('/me/password',
  authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!bcrypt.compareSync(req.body.currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = bcrypt.hashSync(req.body.newPassword, 10);
    db.prepare("UPDATE users SET password_hash=?, must_change_password=0, updated_at=datetime('now') WHERE id=?").run(hash, req.user.id);
    res.json({ message: 'Password updated' });
  }
);

module.exports = router;
