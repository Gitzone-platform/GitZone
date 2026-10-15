BEGIN
;
-- Phase 13.4: shared, case-insensitive namespace.
-- The namespace is maintained by PostgreSQL triggers, not application-only checks.
-- Existing data is preserved. Migration aborts if any collision exists.
-- Prevent concurrent writes while checking and copying existing names.
-- These locks must remain held until the migration transaction commits.
LOCK TABLE "User",
"Organization" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "NamespaceEntry" (
  "name" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  CONSTRAINT "NamespaceEntry_pkey" PRIMARY KEY ("name"),
  CONSTRAINT "NamespaceEntry_ownerType_ownerId_key" UNIQUE ("ownerType", "ownerId"),
  CONSTRAINT "NamespaceEntry_ownerType_check" CHECK ("ownerType" IN ('USER', 'ORGANIZATION')),
  CONSTRAINT "NamespaceEntry_name_lowercase_check" CHECK ("name" = LOWER("name"))
);
-- Fail before installing triggers if legacy records collide.
DO
$$
BEGIN
IF EXISTS (
  SELECT
    1
  FROM
    (
      SELECT
        LOWER("username") AS name
      FROM
        "User"
      UNION ALL
      SELECT
        LOWER("slug") AS name
      FROM
        "Organization"
    ) AS names
  GROUP BY
    name
  HAVING
    COUNT(*) > 1
) THEN RAISE EXCEPTION 'Shared namespace migration blocked: existing names collide';
END IF;
END;
$$
;
INSERT INTO
  "NamespaceEntry" ("name", "ownerType", "ownerId")
SELECT
  LOWER("username"),
  'USER',
  "id"
FROM
  "User";
INSERT INTO
  "NamespaceEntry" ("name", "ownerType", "ownerId")
SELECT
  LOWER("slug"),
  'ORGANIZATION',
  "id"
FROM
  "Organization";
CREATE FUNCTION "sync_shared_namespace"() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET
  search_path = pg_catalog,
  public AS
$$
DECLARE
namespace_type TEXT;
old_name TEXT;
new_name TEXT;
BEGIN
IF TG_TABLE_NAME = 'User' THEN namespace_type := 'USER';
ELSIF TG_TABLE_NAME = 'Organization' THEN namespace_type := 'ORGANIZATION';
ELSE RAISE EXCEPTION 'Unsupported namespace owner table';
END IF;
IF TG_OP = 'DELETE' THEN
DELETE FROM
  "NamespaceEntry"
WHERE
  "ownerType" = namespace_type
  AND "ownerId" = OLD."id";
RETURN OLD;
END IF;
IF namespace_type = 'USER' THEN new_name := LOWER(NEW."username");
IF TG_OP = 'UPDATE' THEN old_name := LOWER(OLD."username");
END IF;
ELSE new_name := LOWER(NEW."slug");
IF TG_OP = 'UPDATE' THEN old_name := LOWER(OLD."slug");
END IF;
END IF;
IF TG_OP = 'INSERT' THEN
INSERT INTO
  "NamespaceEntry" ("name", "ownerType", "ownerId")
VALUES
  (new_name, namespace_type, NEW."id");
RETURN NEW;
END IF;
IF NEW."id" IS DISTINCT FROM OLD."id" THEN RAISE EXCEPTION 'Namespace owner ID cannot be changed';
END IF;
IF new_name IS DISTINCT FROM old_name THEN
UPDATE
  "NamespaceEntry"
SET
  "name" = new_name
WHERE
  "ownerType" = namespace_type
  AND "ownerId" = NEW."id";
IF NOT FOUND THEN RAISE EXCEPTION 'Missing namespace entry for owner';
END IF;
ELSE PERFORM 1
FROM
  "NamespaceEntry"
WHERE
  "ownerType" = namespace_type
  AND "ownerId" = NEW."id"
  AND "name" = new_name;
IF NOT FOUND THEN RAISE EXCEPTION 'Missing or inconsistent namespace entry';
END IF;
END IF;
RETURN NEW;
END;
$$
;
CREATE TRIGGER "User_shared_namespace_insert"
AFTER
INSERT
  ON "User" FOR EACH ROW EXECUTE FUNCTION "sync_shared_namespace"();
CREATE TRIGGER "User_shared_namespace_update"
AFTER
UPDATE
  ON "User" FOR EACH ROW EXECUTE FUNCTION "sync_shared_namespace"();
CREATE TRIGGER "User_shared_namespace_delete"
AFTER
  DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION "sync_shared_namespace"();
CREATE TRIGGER "Organization_shared_namespace_insert"
AFTER
INSERT
  ON "Organization" FOR EACH ROW EXECUTE FUNCTION "sync_shared_namespace"();
CREATE TRIGGER "Organization_shared_namespace_update"
AFTER
UPDATE
  ON "Organization" FOR EACH ROW EXECUTE FUNCTION "sync_shared_namespace"();
CREATE TRIGGER "Organization_shared_namespace_delete"
AFTER
  DELETE ON "Organization" FOR EACH ROW EXECUTE FUNCTION "sync_shared_namespace"();
COMMIT;