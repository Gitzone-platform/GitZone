-- CreateTable
CREATE TABLE "RepositoryStar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryStar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryStar_repositoryId_idx" ON "RepositoryStar"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryStar_userId_repositoryId_key" ON "RepositoryStar"("userId", "repositoryId");

-- AddForeignKey
ALTER TABLE "RepositoryStar" ADD CONSTRAINT "RepositoryStar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryStar" ADD CONSTRAINT "RepositoryStar_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
