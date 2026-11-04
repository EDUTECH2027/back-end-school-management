-- CreateTable
CREATE TABLE "subject_coefficient_overrides" (
    "id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "class_id" TEXT,
    "grade_level_id" TEXT,
    "coefficient" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subject_coefficient_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subject_coefficient_overrides_subject_id_idx" ON "subject_coefficient_overrides"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_coefficient_overrides_class_id_subject_id_key" ON "subject_coefficient_overrides"("class_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_coefficient_overrides_grade_level_id_subject_id_key" ON "subject_coefficient_overrides"("grade_level_id", "subject_id");

-- AddForeignKey
ALTER TABLE "subject_coefficient_overrides" ADD CONSTRAINT "subject_coefficient_overrides_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_coefficient_overrides" ADD CONSTRAINT "subject_coefficient_overrides_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_coefficient_overrides" ADD CONSTRAINT "subject_coefficient_overrides_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one scope per override, and a strictly positive weight.
ALTER TABLE "subject_coefficient_overrides"
  ADD CONSTRAINT "subject_coefficient_overrides_one_scope"
  CHECK (("class_id" IS NULL) <> ("grade_level_id" IS NULL)),
  ADD CONSTRAINT "subject_coefficient_overrides_positive"
  CHECK ("coefficient" > 0);
