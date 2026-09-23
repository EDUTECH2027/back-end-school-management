-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('manual', 'qr_scan');

-- AlterTable
ALTER TABLE "teacher_attendance"
  ADD COLUMN "scan_time" TIMESTAMP(3),
  ADD COLUMN "qr_code_id" TEXT,
  ADD COLUMN "source" "AttendanceSource" NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "attendance_qr_codes" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "attendance_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_qr_codes_month_key" ON "attendance_qr_codes"("month");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_qr_codes_token_key" ON "attendance_qr_codes"("token");

-- CreateTable
CREATE TABLE "attendance_settings" (
    "id" TEXT NOT NULL,
    "arrival_threshold" TEXT NOT NULL DEFAULT '07:30',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_settings_pkey" PRIMARY KEY ("id")
);
