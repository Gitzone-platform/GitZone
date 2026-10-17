-- Organization repositories have organizationId and no user owner.
-- User repositories have ownerId and no organization owner.
-- Exactly one owner must be present.

ALTER TABLE "Repository"
  ALTER COLUMN "ownerId" DROP NOT NULL;

ALTER TABLE "Repository"
  ADD CONSTRAINT "Repository_exactly_one_owner_check"
  CHECK (
    ("ownerId" IS NOT NULL AND "organizationId" IS NULL)
    OR
    ("ownerId" IS NULL AND "organizationId" IS NOT NULL)
  );