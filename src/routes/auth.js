const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const platformClient = require('../db/platformClient');
const tenantPool = require('../db/tenantPool');
const authenticate = require('../middleware/auth');

const SECRET = () => process.env.JWT_SECRET || 'dev_secret';
const EXPIRES = () => process.env.JWT_EXPIRES_IN || '24h';

// POST /api/auth/login
// Checks platform admins first, then routes to the correct tenant schema via the
// cross-tenant email -> school_id directory (see prisma/platform/schema.prisma).
router.post('/login',
  // Note: no .normalizeEmail() here — it lowercases *and* strips gmail dots/subaddresses,
  // which would silently diverge from whatever case the email was stored in at write time.
  // Lookups below use a case-insensitive filter instead, so login is case-insensitive
  // without mutating input.
  body('email').isEmail().trim(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password } = req.body;

    const platformAdmin = await platformClient.platformAdmin.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
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

    const dirEntry = await platformClient.userDirectory.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (!dirEntry) return res.status(401).json({ error: 'Invalid email or password' });

    const school = await platformClient.school.findUnique({
      where: { id: dirEntry.school_id },
      select: { status: true },
    });
    if (!school || school.status !== 'active') return res.status(403).json({ error: 'School account is not active' });

    const tenantDb = tenantPool.getOrOpen(dirEntry.school_id);
    const user = await tenantDb.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const payload = {
      id: user.id, email: user.email, role: user.role, name: user.name,
      initials: user.initials,
      teacher_id: user.teacher_id || null,
      student_id: user.student_id || null,
      parent_id: user.parent_id || null,
      school_id: dirEntry.school_id,
      scope: 'tenant',
      must_change_password: !!user.must_change_password,
    };
    const token = jwt.sign(payload, SECRET(), { expiresIn: EXPIRES() });
    res.json({ token, user: payload });
  }
);

// POST /api/auth/logout  (stateless — client discards token)
router.post('/logout', (_req, res) => res.json({ message: 'Logged out' }));

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  const user = await req.db.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, name: true, email: true, role: true, initials: true,
      teacher_id: true, student_id: true, parent_id: true, must_change_password: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/auth/me/password
router.put('/me/password',
  authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const user = await req.db.user.findUnique({ where: { id: req.user.id } });
    if (!bcrypt.compareSync(req.body.currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = bcrypt.hashSync(req.body.newPassword, 10);
    await req.db.user.update({
      where: { id: req.user.id },
      data: { password_hash: hash, must_change_password: false, updated_at: new Date() },
    });
    res.json({ message: 'Password updated' });
  }
);

module.exports = router;
