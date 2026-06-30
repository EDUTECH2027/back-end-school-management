const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const authenticate = require('../middleware/auth');

const SECRET = () => process.env.JWT_SECRET || 'dev_secret';
const EXPIRES = () => process.env.JWT_EXPIRES_IN || '24h';

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const payload = {
      id: user.id, email: user.email, role: user.role, name: user.name,
      initials: user.initials,
      teacher_id: user.teacher_id || null,
      student_id: user.student_id || null,
      parent_id:  user.parent_id  || null,
    };
    const token = jwt.sign(payload, SECRET(), { expiresIn: EXPIRES() });
    res.json({ token, user: payload });
  }
);

// POST /api/auth/logout  (stateless — client discards token)
router.post('/logout', (_req, res) => res.json({ message: 'Logged out' }));

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id,name,email,role,initials,teacher_id,student_id,parent_id FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
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
    db.prepare("UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?").run(hash, req.user.id);
    res.json({ message: 'Password updated' });
  }
);

module.exports = router;
