-- AlterTable
ALTER TABLE "platform_admins"
  ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3),
  ADD COLUMN "last_failed_login_at" TIMESTAMP(3),
  ADD COLUMN "totp_secret" TEXT,
  ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "totp_enrolled_at" TIMESTAMP(3),
  ADD COLUMN "recovery_codes" JSONB;

-- CreateTable
CREATE TABLE "auth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "school_id" TEXT,
    "family_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "auth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_refresh_tokens_token_hash_key" ON "auth_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_refresh_tokens_subject_type_subject_id_idx" ON "auth_refresh_tokens"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "auth_refresh_tokens_family_id_idx" ON "auth_refresh_tokens"("family_id");
