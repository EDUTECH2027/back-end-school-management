const { v4: uuid } = require('uuid');
const platformDb = require('../../db/platform');

function logAction(req, action, targetType, targetId, meta) {
  platformDb.prepare(`
    INSERT INTO system_logs (id, actor_type, actor_id, actor_name, action, target_type, target_id, meta, created_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now'))
  `).run(
    uuid(),
    'platform_admin',
    req.user?.id || null,
    req.user?.name || null,
    action,
    targetType || null,
    targetId || null,
    meta ? JSON.stringify(meta) : null
  );
}

module.exports = { logAction };
