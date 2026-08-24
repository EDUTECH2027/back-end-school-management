-- CreateTable
CREATE TABLE "report_card_templates" (
    "id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "file_path" TEXT,
    "file_name" TEXT,
    "page_width" DOUBLE PRECISION,
    "page_height" DOUBLE PRECISION,
    "fields" JSONB,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_card_templates_pkey" PRIMARY KEY ("id")
);
