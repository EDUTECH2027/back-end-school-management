-- CreateTable
CREATE TABLE "marks_entry_periods" (
    "id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "opens_at" TIMESTAMP(3),
    "closes_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marks_entry_periods_pkey" PRIMARY KEY ("id")
);
