-- CreateTable
CREATE TABLE "marks_entry_sessions" (
    "sequence" INTEGER NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT false,
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marks_entry_sessions_pkey" PRIMARY KEY ("sequence")
);
