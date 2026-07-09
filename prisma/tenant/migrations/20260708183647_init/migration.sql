-- CreateEnum
CREATE TYPE "Role" AS ENUM ('super_admin', 'head_teacher', 'teacher', 'student', 'parent');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late', 'excused');

-- CreateEnum
CREATE TYPE "TermName" AS ENUM ('first', 'second', 'third');

-- CreateEnum
CREATE TYPE "Day" AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday');

-- CreateEnum
CREATE TYPE "ReportCardStatus" AS ENUM ('draft', 'finalized', 'published', 'printed');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('pending', 'partial', 'paid', 'overdue', 'waived');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('draft', 'pending', 'paid');

-- CreateEnum
CREATE TYPE "BehaviorCategory" AS ENUM ('positive', 'negative', 'neutral');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ForumMessageType" AS ENUM ('text', 'image', 'voice');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "initials" TEXT NOT NULL,
    "teacher_id" TEXT,
    "student_id" TEXT,
    "parent_id" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "head_teacher" TEXT,
    "motto" TEXT,
    "logo_url" TEXT,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "name" "TermName" NOT NULL,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_levels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "grade_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "gender" "Gender",
    "subjects" JSONB NOT NULL DEFAULT '[]',
    "class_assigned" TEXT,
    "qualification" TEXT,
    "join_date" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "grade_level_id" TEXT,
    "grade_level_name" TEXT,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 40,
    "room" TEXT,
    "class_teacher_id" TEXT,
    "class_teacher_name" TEXT,
    "enrolled" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "student_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" TEXT,
    "gender" "Gender",
    "class_id" TEXT,
    "class_name" TEXT,
    "grade_level_name" TEXT,
    "photo_url" TEXT,
    "guardian_name" TEXT,
    "guardian_phone" TEXT,
    "guardian_relationship" TEXT,
    "admission_date" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "address" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "relationship" TEXT,
    "address" TEXT,
    "occupation" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_students" (
    "parent_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,

    CONSTRAINT "parent_students_pkey" PRIMARY KEY ("parent_id","student_id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "student_name" TEXT,
    "student_number" TEXT,
    "class_id" TEXT NOT NULL,
    "class_name" TEXT,
    "date" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_attendance" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "teacher_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_schedule" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "day" "Day" NOT NULL,
    "period_key" TEXT NOT NULL,
    "period_label" TEXT,
    "time" TEXT,
    "class_id" TEXT NOT NULL,
    "class_name" TEXT,
    "subject_name" TEXT NOT NULL,
    "room" TEXT,

    CONSTRAINT "teacher_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "student_name" TEXT,
    "student_number" TEXT,
    "subject_id" TEXT NOT NULL,
    "subject_name" TEXT,
    "term_id" TEXT NOT NULL,
    "class_id" TEXT,
    "ca_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exam_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grade" TEXT,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "student_name" TEXT,
    "student_number" TEXT,
    "class_name" TEXT,
    "grade_level_name" TEXT,
    "term_id" TEXT NOT NULL,
    "term_name" TEXT,
    "academic_year" TEXT,
    "total_marks_obtained" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_marks_possible" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "class_position" INTEGER,
    "out_of" INTEGER,
    "days_present" INTEGER NOT NULL DEFAULT 0,
    "days_absent" INTEGER NOT NULL DEFAULT 0,
    "total_school_days" INTEGER NOT NULL DEFAULT 0,
    "conduct" TEXT,
    "class_teacher_comment" TEXT,
    "head_teacher_comment" TEXT,
    "status" "ReportCardStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_card_entries" (
    "id" TEXT NOT NULL,
    "report_card_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "subject_name" TEXT,
    "ca_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exam_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grade" TEXT,
    "remark" TEXT,
    "position" INTEGER,
    "teacher_comment" TEXT,

    CONSTRAINT "report_card_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_records" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "student_name" TEXT,
    "student_number" TEXT,
    "class_id" TEXT,
    "class_name" TEXT,
    "fee_name" TEXT NOT NULL,
    "academic_year" TEXT,
    "amount_due" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "FeeStatus" NOT NULL DEFAULT 'pending',
    "due_date" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "fee_record_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "payment_date" TEXT,
    "receipt_number" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_payroll" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "hourly_rate" DOUBLE PRECISION NOT NULL DEFAULT 3500,
    "contracted_hours" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "base_allowance" DOUBLE PRECISION NOT NULL DEFAULT 50000,
    "absence_deduction" DOUBLE PRECISION NOT NULL DEFAULT 12000,
    "late_deduction" DOUBLE PRECISION NOT NULL DEFAULT 2500,
    "hours_worked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "absences" INTEGER NOT NULL DEFAULT 0,
    "late_coming" INTEGER NOT NULL DEFAULT 0,
    "bonus" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT DEFAULT '',
    "status" "PayrollStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT,
    "author_id" TEXT,
    "audience" TEXT DEFAULT 'all',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT DEFAULT 'info',
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_alerts" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "sender" TEXT,
    "sender_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sent_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_threads" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tag" TEXT DEFAULT 'general',
    "author" TEXT,
    "author_id" TEXT,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "author_id" TEXT,
    "type" "ForumMessageType" NOT NULL DEFAULT 'text',
    "content" TEXT,
    "image_url" TEXT,
    "voice_url" TEXT,
    "voice_duration" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_behavior" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "class_id" TEXT,
    "teacher_id" TEXT,
    "date" TEXT NOT NULL,
    "category" "BehaviorCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "action_taken" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_behavior_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_withdrawals" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "payroll_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "reviewed_at" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "grade_levels_name_key" ON "grade_levels"("name");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_name_key" ON "subjects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_code_key" ON "subjects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_email_key" ON "teachers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "classes_name_key" ON "classes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "students_student_number_key" ON "students"("student_number");

-- CreateIndex
CREATE INDEX "students_class_id_idx" ON "students"("class_id");

-- CreateIndex
CREATE INDEX "attendance_records_date_idx" ON "attendance_records"("date");

-- CreateIndex
CREATE INDEX "attendance_records_class_id_idx" ON "attendance_records"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_student_id_date_key" ON "attendance_records"("student_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendance_teacher_id_date_key" ON "teacher_attendance"("teacher_id", "date");

-- CreateIndex
CREATE INDEX "teacher_schedule_teacher_id_idx" ON "teacher_schedule"("teacher_id");

-- CreateIndex
CREATE INDEX "marks_student_id_idx" ON "marks"("student_id");

-- CreateIndex
CREATE INDEX "marks_term_id_idx" ON "marks"("term_id");

-- CreateIndex
CREATE UNIQUE INDEX "marks_student_id_subject_id_term_id_key" ON "marks"("student_id", "subject_id", "term_id");

-- CreateIndex
CREATE INDEX "fee_records_student_id_idx" ON "fee_records"("student_id");

-- CreateIndex
CREATE INDEX "teacher_payroll_month_idx" ON "teacher_payroll"("month");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_payroll_teacher_id_month_key" ON "teacher_payroll"("teacher_id", "month");

-- CreateIndex
CREATE INDEX "student_behavior_student_id_idx" ON "student_behavior"("student_id");

-- CreateIndex
CREATE INDEX "student_behavior_class_id_idx" ON "student_behavior"("class_id");

-- CreateIndex
CREATE INDEX "salary_withdrawals_teacher_id_idx" ON "salary_withdrawals"("teacher_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_class_teacher_id_fkey" FOREIGN KEY ("class_teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parents" ADD CONSTRAINT "parents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_schedule" ADD CONSTRAINT "teacher_schedule_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_schedule" ADD CONSTRAINT "teacher_schedule_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_entries" ADD CONSTRAINT "report_card_entries_report_card_id_fkey" FOREIGN KEY ("report_card_id") REFERENCES "report_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_entries" ADD CONSTRAINT "report_card_entries_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_records_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_fee_record_id_fkey" FOREIGN KEY ("fee_record_id") REFERENCES "fee_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_payroll" ADD CONSTRAINT "teacher_payroll_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_alerts" ADD CONSTRAINT "email_alerts_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_messages" ADD CONSTRAINT "forum_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_messages" ADD CONSTRAINT "forum_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_behavior" ADD CONSTRAINT "student_behavior_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_behavior" ADD CONSTRAINT "student_behavior_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_behavior" ADD CONSTRAINT "student_behavior_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_behavior" ADD CONSTRAINT "student_behavior_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_withdrawals" ADD CONSTRAINT "salary_withdrawals_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_withdrawals" ADD CONSTRAINT "salary_withdrawals_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "teacher_payroll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_withdrawals" ADD CONSTRAINT "salary_withdrawals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
