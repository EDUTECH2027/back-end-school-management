-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3),
  ADD COLUMN "last_failed_login_at" TIMESTAMP(3),
  ADD COLUMN "totp_secret" TEXT,
  ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "totp_enrolled_at" TIMESTAMP(3),
  ADD COLUMN "recovery_codes" JSONB;

-- AlterTable
ALTER TABLE "school"
  ADD COLUMN "require_admin_2fa" BOOLEAN NOT NULL DEFAULT false;
