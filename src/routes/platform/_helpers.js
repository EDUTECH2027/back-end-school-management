/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const { v4: uuid } = require('uuid');
const platformClient = require('../../db/platformClient');

async function logAction(req, action, targetType, targetId, meta) {
  await platformClient.systemLog.create({
    data: {
      id: uuid(),
      actor_type: 'platform_admin',
      actor_id: req.user?.id || null,
      actor_name: req.user?.name || null,
      action,
      target_type: targetType || null,
      target_id: targetId || null,
      meta: meta ? JSON.stringify(meta) : null,
    },
  });
}

module.exports = { logAction };
