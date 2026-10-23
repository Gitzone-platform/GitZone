CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamRepository" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "permission" "RepositoryPermission" NOT NULL DEFAULT 'READ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamRepository_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Team_organizationId_slug_key"
    ON "Team"("organizationId", "slug");
CREATE UNIQUE INDEX "Team_organizationId_name_key"
    ON "Team"("organizationId", "name");
CREATE INDEX "Team_organizationId_idx"
    ON "Team"("organizationId");

CREATE UNIQUE INDEX "TeamMember_teamId_userId_key"
    ON "TeamMember"("teamId", "userId");
CREATE INDEX "TeamMember_userId_idx"
    ON "TeamMember"("userId");

CREATE UNIQUE INDEX "TeamRepository_teamId_repositoryId_key"
    ON "TeamRepository"("teamId", "repositoryId");
CREATE INDEX "TeamRepository_repositoryId_idx"
    ON "TeamRepository"("repositoryId");

ALTER TABLE "Team"
    ADD CONSTRAINT "Team_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMember"
    ADD CONSTRAINT "TeamMember_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMember"
    ADD CONSTRAINT "TeamMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamRepository"
    ADD CONSTRAINT "TeamRepository_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamRepository"
    ADD CONSTRAINT "TeamRepository_repositoryId_fkey"
    FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;