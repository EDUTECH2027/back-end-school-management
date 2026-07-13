# Login Credentials

## Platform Admin
- Email: `superadmin@platform.local`
- Password: `SuperAdmin@2025`
- Role: `platform_owner`
- Notes: bootstrapped automatically on server startup if no platform admin exists. Can be overridden with environment variables:
  - `PLATFORM_ADMIN_EMAIL`
  - `PLATFORM_ADMIN_PASSWORD`

## Tenant School Admin
- Email: `admin@school.com`
- Password: `Admin@2025`
- Role: `super_admin` (tenant-level admin)
- Notes: inserted by `backend/src/db/clean.js` and `backend/src/db/seed.js` as the default school admin account.

## Environment Variables
- `PLATFORM_ADMIN_EMAIL` — overrides the bootstrapped platform owner email
- `PLATFORM_ADMIN_PASSWORD` — overrides the bootstrapped platform owner password

## Important
- These are default development/test credentials and should be changed before deploying to production.
- The tenant school admin account is created inside the tenant database during seed/clean operations, not in the platform schema.
