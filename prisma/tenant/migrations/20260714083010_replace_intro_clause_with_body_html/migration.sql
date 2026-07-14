/*
  Warnings:

  - You are about to drop the column `clause` on the `certificates` table. All the data in the column will be lost.
  - You are about to drop the column `intro` on the `certificates` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "certificates" DROP COLUMN "clause",
DROP COLUMN "intro",
ADD COLUMN     "body_html" TEXT NOT NULL DEFAULT '';
