-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "forkedFromId" TEXT;

-- CreateIndex
CREATE INDEX "Repository_forkedFromId_idx" ON "Repository"("forkedFromId");

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_forkedFromId_fkey" FOREIGN KEY ("forkedFromId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
