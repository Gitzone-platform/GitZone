-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Repository_organizationId_name_key" ON "Repository"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
