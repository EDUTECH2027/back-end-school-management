const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const guard = [authenticate, authorize('super_admin', 'head_teacher')];

// GET /api/users
router.get('/', ...guard, (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, role, initials, teacher_id, student_id, parent_id, created_at
    FROM users ORDER BY name
  `).all();
  res.json(users);
});

// GET /api/users/:id
router.get('/:id', ...guard, (req, res) => {
  const user = db.prepare('SELECT id,name,email,role,initials,teacher_id,student_id,parent_id,created_at FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// POST /api/users
router.post('/', ...guard, (req, res) => {
  const { name, email, password, role, initials, teacher_id, student_id, parent_id } = req.body;
  if (!name || !email || !password || !role) return res.status(422).json({ error: 'name, email, password, role required' });

  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  const ini = initials || name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);

  const create = db.transaction(() => {
    db.prepare(`INSERT INTO users (id,name,email,password_hash,role,initials,teacher_id,student_id,parent_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`
    ).run(id, name, email, hash, role, ini, teacher_id || null, student_id || null, parent_id || null);

    if (teacher_id) db.prepare("UPDATE teachers SET user_id=?, updated_at=datetime('now') WHERE id=?").run(id, teacher_id);
    if (student_id) db.prepare("UPDATE students SET user_id=?, updated_at=datetime('now') WHERE id=?").run(id, student_id);
    if (parent_id)  db.prepare("UPDATE parents  SET user_id=?, updated_at=datetime('now') WHERE id=?").run(id, parent_id);
  });
  create();

  const user = db.prepare('SELECT id,name,email,role,initials,teacher_id,student_id,parent_id,created_at FROM users WHERE id=?').get(id);
  res.status(201).json(user);
});

// PUT /api/users/:id
router.put('/:id', ...guard, (req, res) => {
  const { name, email, role, initials, teacher_id, student_id, parent_id } = req.body;
  const current = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'User not found' });

  const update = db.transaction(() => {
    db.prepare(`UPDATE users SET name=?,email=?,role=?,initials=?,teacher_id=?,student_id=?,parent_id=?,updated_at=datetime('now') WHERE id=?`)
      .run(name ?? current.name, email ?? current.email, role ?? current.role,
           initials ?? current.initials, teacher_id ?? current.teacher_id,
           student_id ?? current.student_id, parent_id ?? current.parent_id, req.params.id);

    if (teacher_id !== undefined) db.prepare("UPDATE teachers SET user_id=?, updated_at=datetime('now') WHERE id=?").run(req.params.id, teacher_id);
    if (student_id !== undefined) db.prepare("UPDATE students SET user_id=?, updated_at=datetime('now') WHERE id=?").run(req.params.id, student_id);
    if (parent_id  !== undefined) db.prepare("UPDATE parents  SET user_id=?, updated_at=datetime('now') WHERE id=?").run(req.params.id, parent_id);
  });
  update();

  res.json(db.prepare('SELECT id,name,email,role,initials,teacher_id,student_id,parent_id,created_at FROM users WHERE id=?').get(req.params.id));
});

// PATCH /api/users/:id/password
router.patch('/:id/password', ...guard, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(422).json({ error: 'Password must be at least 6 characters' });
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?").run(hash, req.params.id);
  res.json({ message: 'Password updated' });
});

// DELETE /api/users/:id
router.delete('/:id', ...guard, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const del = db.transaction(() => {
    if (user.teacher_id) db.prepare("UPDATE teachers SET user_id=NULL, updated_at=datetime('now') WHERE id=?").run(user.teacher_id);
    if (user.student_id) db.prepare("UPDATE students SET user_id=NULL, updated_at=datetime('now') WHERE id=?").run(user.student_id);
    if (user.parent_id)  db.prepare("UPDATE parents  SET user_id=NULL, updated_at=datetime('now') WHERE id=?").run(user.parent_id);
    db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  });
  del();
  res.status(204).end();
});

module.exports = router;
