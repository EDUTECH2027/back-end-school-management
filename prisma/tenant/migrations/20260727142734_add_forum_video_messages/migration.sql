-- AlterEnum
ALTER TYPE "ForumMessageType" ADD VALUE 'video';

-- AlterTable
ALTER TABLE "forum_messages" ADD COLUMN     "video_duration" INTEGER,
ADD COLUMN     "video_url" TEXT;
