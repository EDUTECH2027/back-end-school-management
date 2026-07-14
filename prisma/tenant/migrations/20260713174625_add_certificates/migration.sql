-- CreateEnum
CREATE TYPE "CertificateKind" AS ENUM ('certificate', 'attestation');

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "student_name" TEXT,
    "student_number" TEXT,
    "class_name" TEXT,
    "doc_type_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "kind" "CertificateKind" NOT NULL DEFAULT 'certificate',
    "doc_label" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "clause" TEXT NOT NULL,
    "issue_date" TEXT NOT NULL,
    "cert_number" TEXT NOT NULL,
    "signatory_name" TEXT,
    "signatory_title" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "certificates_student_id_idx" ON "certificates"("student_id");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
