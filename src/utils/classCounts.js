/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// `classes.enrolled` is a stored counter that only some code paths refresh (bulk import,
// year-end), so it drifts. Every API that returns classes overlays the real headcount —
// active students currently placed in the class — so all screens agree with the student list.
async function withLiveEnrolled(db, classes) {
  const list = Array.isArray(classes) ? classes : [classes];
  const ids = list.filter(Boolean).map((c) => c.id).filter(Boolean);
  if (ids.length === 0) return classes;

  const rows = await db.student.groupBy({
    by: ['class_id'],
    where: { class_id: { in: ids }, is_active: true },
    _count: { _all: true },
  });
  const counts = new Map(rows.map((r) => [r.class_id, r._count._all]));
  const overlay = (c) => (c ? { ...c, enrolled: counts.get(c.id) ?? 0 } : c);
  return Array.isArray(classes) ? list.map(overlay) : overlay(classes);
}

module.exports = { withLiveEnrolled };
