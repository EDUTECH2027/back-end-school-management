-- AlterTable
ALTER TABLE "report_card_entries" ADD COLUMN     "coefficient" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "report_cards" ADD COLUMN     "sequence1_average" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "sequence2_average" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "coefficient" DOUBLE PRECISION NOT NULL DEFAULT 1;
