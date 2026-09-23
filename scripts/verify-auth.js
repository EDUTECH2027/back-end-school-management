/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Isolated auth-flow regression check for the Postgres/Prisma port (Phase 0 of
// the migration plan). Mounts ONLY the ported auth router + a tiny protected
// probe route on a throwaway Express app — the rest of the route files aren't
// ported yet, so booting the full backend/src/index.js would fail elsewhere.
require('dotenv').config();
require('express-async-errors');
const express = require('express');
const bcrypt = require('bcryptjs');
const authRouter = require('../src/routes/auth');
const authenticate = require('../src/middleware/auth');
const platformClient = require('../src/db/platformClient');
const tenantPool = require('../src/db/tenantPool');

const PORT = 4999;
const BASE = `http://localhost:${PORT}`;

// Known-good credentials confirmed against the migrated data before this script
// was written: platform bootstrap owner, and a real pre-migration tenant user
// (admin@edutech.com / Admin@2025 — from src/db/seed.js's seed insert, NOT a
// freshly created post-migration account, so this actually proves the migrated
// password_hash still verifies through the new bcrypt.compareSync call path).
const PLATFORM_EMAIL = 'superadmin@platform.local';
const PLATFORM_PASSWORD = 'SuperAdmin@2025';
const TENANT_SCHOOL_ID = '250b289e-2056-46ef-ac38-ad823dc6f1d3';
const TENANT_ADMIN_EMAIL = 'admin@edutech.com';
const TENANT_ADMIN_PASSWORD = 'Admin@2025';

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  [OK] ${label}`); }
  else { failures++; console.error(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`); }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.get('/api/_probe', authenticate, (req, res) => res.json({ user: req.user, hasDb: !!req.db }));
  const server = app.listen(PORT);

  try {
    console.log('\n1. Platform admin login (real bootstrap credentials)');
    {
      const { status, body } = await login(PLATFORM_EMAIL, PLATFORM_PASSWORD);
      check('status 200', status === 200, `got ${status}: ${JSON.stringify(body)}`);
      check('scope=platform', body.user?.scope === 'platform');
      check('role=platform_owner', body.user?.role === 'platform_owner');
    }

    console.log('\n2. Tenant super_admin login with a REAL pre-existing password (proves migrated hash still verifies)');
    let tenantToken;
    {
      const { status, body } = await login(TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
      check('status 200', status === 200, `got ${status}: ${JSON.stringify(body)}`);
      check('scope=tenant', body.user?.scope === 'tenant');
      check('role=super_admin', body.user?.role === 'super_admin');
      check('school_id matches', body.user?.school_id === TENANT_SCHOOL_ID);
      tenantToken = body.token;
    }

    console.log('\n3. Student matricule login without a password');
    {
      const { status, body } = await login('BSPS-2025-001', '');
      check('matricule status 200', status === 200, `got ${status}: ${JSON.stringify(body)}`);
      check('matricule scope=tenant', body.user?.scope === 'tenant');
      check('matricule role=student', body.user?.role === 'student');
      check('matricule student_id populated', !!body.user?.student_id);
    }

    {
      const { status } = await login(TENANT_ADMIN_EMAIL, '');
      check('email without password -> 422', status === 422);
    }

    console.log('\n4. Wrong password rejected');
    {
      const { status } = await login(TENANT_ADMIN_EMAIL, 'not-the-password');
      check('status 401', status === 401);
    }

    console.log('\n5. Nonexistent email rejected without leaking which case it was');
    {
      const { status, body } = await login('nobody-at-all@nowhere.test', 'whatever');
      check('status 401', status === 401);
      check('generic error message', body.error === 'Invalid email or password');
    }

    console.log('\n6. Protected probe route resolves req.user + req.db from the token');
    {
      const res = await fetch(`${BASE}/api/_probe`, { headers: { Authorization: `Bearer ${tenantToken}` } });
      const body = await res.json();
      check('status 200', res.status === 200);
      check('req.user.email matches', body.user?.email === TENANT_ADMIN_EMAIL);
      check('req.db attached', body.hasDb === true);
    }

    console.log('\n7. Suspending the school locks out the existing token; reactivating restores it');
    {
      await platformClient.school.update({ where: { id: TENANT_SCHOOL_ID }, data: { status: 'suspended' } });
      const res1 = await fetch(`${BASE}/api/_probe`, { headers: { Authorization: `Bearer ${tenantToken}` } });
      check('suspended -> 403', res1.status === 403, `got ${res1.status}`);

      await platformClient.school.update({ where: { id: TENANT_SCHOOL_ID }, data: { status: 'active' } });
      const res2 = await fetch(`${BASE}/api/_probe`, { headers: { Authorization: `Bearer ${tenantToken}` } });
      check('reactivated -> 200', res2.status === 200, `got ${res2.status}`);
    }

    console.log('\n8. Password change flow (round-trips back to the original password when done)');
    {
      const wrongRes = await fetch(`${BASE}/api/auth/me/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantToken}` },
        body: JSON.stringify({ currentPassword: 'nope', newPassword: 'Temp@12345' }),
      });
      check('wrong current password -> 401', wrongRes.status === 401);

      const changeRes = await fetch(`${BASE}/api/auth/me/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantToken}` },
        body: JSON.stringify({ currentPassword: TENANT_ADMIN_PASSWORD, newPassword: 'Temp@12345' }),
      });
      check('correct current password -> 200', changeRes.status === 200, `got ${changeRes.status}`);

      const oldFails = await login(TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
      check('old password now fails', oldFails.status === 401);

      const newWorks = await login(TENANT_ADMIN_EMAIL, 'Temp@12345');
      check('new password works', newWorks.status === 200);

      // Restore the original password so this script is safe to re-run and
      // doesn't leave the test account in a changed state.
      const restoreToken = newWorks.body.token;
      const restoreRes = await fetch(`${BASE}/api/auth/me/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${restoreToken}` },
        body: JSON.stringify({ currentPassword: 'Temp@12345', newPassword: TENANT_ADMIN_PASSWORD }),
      });
      check('password restored to original', restoreRes.status === 200);
    }

    console.log('\n9. Role-payload spot check for the other roles (teacher/student/parent), using a scoped test-password reset on synthetic seed accounts');
    {
      const tenantDb = tenantPool.getOrOpen(TENANT_SCHOOL_ID);
      const probes = [
        { email: 'bsps2025001@school.local', role: 'student', idField: 'student_id' },
        { email: 'r.zulu@bsps.edu', role: 'teacher', idField: 'teacher_id' },
        { email: 'par1@school.local', role: 'parent', idField: 'parent_id' },
      ];
      for (const p of probes) {
        const original = await tenantDb.user.findFirst({ where: { email: p.email } });
        if (!original) { check(`${p.role} probe account exists`, false, `${p.email} not found`); continue; }
        const testHash = bcrypt.hashSync('ProbeOnly@2025', 10);
        await tenantDb.user.update({ where: { id: original.id }, data: { password_hash: testHash } });

        const { status, body } = await login(p.email, 'ProbeOnly@2025');
        check(`${p.role} login -> 200`, status === 200, `got ${status}`);
        check(`${p.role} role in payload`, body.user?.role === p.role);
        check(`${p.role} ${p.idField} populated`, !!body.user?.[p.idField]);

        // Restore original hash — this was a probe-only mutation.
        await tenantDb.user.update({ where: { id: original.id }, data: { password_hash: original.password_hash } });
      }
    }

    console.log(failures === 0 ? '\nAll auth checks passed.' : `\n${failures} auth check(s) FAILED.`);
  } finally {
    server.close();
    await platformClient.$disconnect();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('Auth verification crashed:', e); process.exit(1); });
