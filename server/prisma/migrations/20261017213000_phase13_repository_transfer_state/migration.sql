CREATE TABLE "RepositoryTransfer" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "sourceOwnerId" TEXT NOT NULL,
    "sourceUsername" TEXT NOT NULL,
    "targetOrgId" TEXT NOT NULL,
    "targetOrgSlug" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepositoryTransfer_repositoryId_key"
ON "RepositoryTransfer"("repositoryId");

CREATE INDEX "RepositoryTransfer_status_idx"
ON "RepositoryTransfer"("status");

CREATE INDEX "RepositoryTransfer_targetOrgId_idx"
ON "RepositoryTransfer"("targetOrgId");

ALTER TABLE "RepositoryTransfer"
ADD CONSTRAINT "RepositoryTransfer_repositoryId_fkey"
FOREIGN KEY ("repositoryId")
REFERENCES "Repository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositoryTransfer"
ADD CONSTRAINT "RepositoryTransfer_sourceOwnerId_fkey"
FOREIGN KEY ("sourceOwnerId")
REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositoryTransfer"
ADD CONSTRAINT "RepositoryTransfer_targetOrgId_fkey"
FOREIGN KEY ("targetOrgId")
REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositoryTransfer"
ADD CONSTRAINT "RepositoryTransfer_status_check"
CHECK ("status" IN ('PENDING', 'MOVING', 'MOVED', 'COMPLETED', 'FAILED'));
