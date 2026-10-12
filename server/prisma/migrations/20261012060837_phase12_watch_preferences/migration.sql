-- CreateEnum
CREATE TYPE "RepositoryWatchPreference" AS ENUM ('ALL', 'PARTICIPATING', 'IGNORE');

-- AlterTable
ALTER TABLE "RepositoryWatch" ADD COLUMN     "preference" "RepositoryWatchPreference" NOT NULL DEFAULT 'ALL';
