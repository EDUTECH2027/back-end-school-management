-- CreateTable
CREATE TABLE "issued_licenses" (
    "id" TEXT NOT NULL,
    "school_name" TEXT NOT NULL,
    "edition" TEXT NOT NULL DEFAULT 'on_prem',
    "seats" INTEGER,
    "max_students" INTEGER,
    "hardware_id" TEXT,
    "instance_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_seen_ip" TEXT,
    "notes" TEXT,

    CONSTRAINT "issued_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issued_licenses_revoked_at_idx" ON "issued_licenses"("revoked_at");
