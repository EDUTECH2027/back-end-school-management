-- CreateEnum
CREATE TYPE "YearEndStatus" AS ENUM ('pending_review', 'promoted', 'repeating', 'withdrawn', 'transferred', 'graduated');

-- AlterTable
ALTER TABLE "academic_years" ADD COLUMN     "closed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "is_final_class" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "next_class_id" TEXT;

-- CreateTable
CREATE TABLE "class_enrollments" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "class_id" TEXT,
    "class_name" TEXT,
    "academic_year_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_end_config" (
    "id" TEXT NOT NULL,
    "pass_average" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "final_class_outcome" TEXT NOT NULL DEFAULT 'graduate',
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "year_end_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_end_decisions" (
    "id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "class_id" TEXT,
    "class_name" TEXT,
    "student_id" TEXT NOT NULL,
    "calculated_average" DOUBLE PRECISION,
    "terms_found" INTEGER NOT NULL DEFAULT 0,
    "terms_expected" INTEGER NOT NULL DEFAULT 3,
    "class_rank" INTEGER,
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "incomplete_reason" TEXT,
    "proposed_status" "YearEndStatus" NOT NULL DEFAULT 'pending_review',
    "status" "YearEndStatus" NOT NULL DEFAULT 'pending_review',
    "validated_at" TIMESTAMP(3),
    "validated_by" TEXT,
    "validated_by_name" TEXT,
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "target_class_id" TEXT,
    "applied_at" TIMESTAMP(3),
    "applied_snapshot" JSONB,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "year_end_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_end_runs" (
    "id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "next_academic_year_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "confirmed_by" TEXT,
    "confirmed_by_name" TEXT,
    "confirmed_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "reversed_by_name" TEXT,
    "reversed_at" TIMESTAMP(3),
    "note" TEXT,
    "summary" JSONB,

    CONSTRAINT "year_end_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_end_audit" (
    "id" TEXT NOT NULL,
    "academic_year_id" TEXT,
    "class_id" TEXT,
    "student_id" TEXT,
    "run_id" TEXT,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "year_end_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_enrollments_class_id_academic_year_id_idx" ON "class_enrollments"("class_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_enrollments_student_id_academic_year_id_key" ON "class_enrollments"("student_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "year_end_decisions_academic_year_id_class_id_idx" ON "year_end_decisions"("academic_year_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "year_end_decisions_academic_year_id_student_id_key" ON "year_end_decisions"("academic_year_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "year_end_runs_academic_year_id_class_id_key" ON "year_end_runs"("academic_year_id", "class_id");

-- CreateIndex
CREATE INDEX "year_end_audit_academic_year_id_class_id_idx" ON "year_end_audit"("academic_year_id", "class_id");

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "year_end_decisions" ADD CONSTRAINT "year_end_decisions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: record every currently-placed student's enrollment for the current academic year,
-- so year-end processing and history work for data that predates this feature. Idempotent.
INSERT INTO "class_enrollments" ("id", "student_id", "class_id", "class_name", "academic_year_id", "source")
SELECT gen_random_uuid()::text, s."id", s."class_id", c."name", ay."id", 'backfill'
FROM "students" s
JOIN "classes" c ON c."id" = s."class_id"
CROSS JOIN (SELECT "id" FROM "academic_years" WHERE "is_current" = true ORDER BY "start_date" DESC LIMIT 1) ay
WHERE s."class_id" IS NOT NULL
ON CONFLICT ("student_id", "academic_year_id") DO NOTHING;

-- Default promotion rules.
INSERT INTO "year_end_config" ("id") VALUES ('s1') ON CONFLICT ("id") DO NOTHING;
