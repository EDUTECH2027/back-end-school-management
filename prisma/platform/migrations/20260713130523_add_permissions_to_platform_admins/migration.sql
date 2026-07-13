-- AlterTable
ALTER TABLE "platform_admins" ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '[]';
