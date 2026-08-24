-- AlterTable
ALTER TABLE "students" ADD COLUMN     "alternate_mobile_number" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "middle_name" TEXT,
ADD COLUMN     "mobile_number" TEXT,
ADD COLUMN     "roll_number" TEXT,
ADD COLUMN     "sibling_ids" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "state" TEXT,
ADD COLUMN     "zip_code" TEXT;

-- CreateTable
CREATE TABLE "student_documents" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_documents_student_id_idx" ON "student_documents"("student_id");

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
