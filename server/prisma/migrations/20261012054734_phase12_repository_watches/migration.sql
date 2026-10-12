-- CreateTable
CREATE TABLE "RepositoryWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryWatch_repositoryId_idx" ON "RepositoryWatch"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryWatch_userId_repositoryId_key" ON "RepositoryWatch"("userId", "repositoryId");

-- AddForeignKey
ALTER TABLE "RepositoryWatch" ADD CONSTRAINT "RepositoryWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryWatch" ADD CONSTRAINT "RepositoryWatch_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
