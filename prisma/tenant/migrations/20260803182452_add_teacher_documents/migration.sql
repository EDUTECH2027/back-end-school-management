-- CreateTable
CREATE TABLE "teacher_documents" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teacher_documents_teacher_id_idx" ON "teacher_documents"("teacher_id");

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "teacher_documents_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
