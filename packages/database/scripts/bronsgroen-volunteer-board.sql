-- Bronsgroen volunteer form: use the translated tags, including board.
--
-- Do not run this against acc or prod until the release that adds the "board"
-- label is deployed. This file is not a Prisma migration and CI does not run it.
-- It only updates the coop with slug bronsgroen. It aborts when that coop is
-- missing or when volunteerInterests is anything other than the list below or
-- the target list, so a second run is a no-op and an unexpected list is left
-- untouched.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f packages/database/scripts/bronsgroen-volunteer-board.sql
--
-- MCP equivalent after deploy, with a READ_WRITE key for Bronsgroen.
-- Stop if list_volunteer_interests is not the current list.
--
-- 1. list_volunteer_interests
--    Expect flyers, stands, workshops, technisch, administratie.
-- 2. update_volunteer_interests (needs canViewVolunteers)
--    {
--      "rename": [
--        {"from": "technisch", "to": "technical"},
--        {"from": "administratie", "to": "admin"}
--      ],
--      "add": ["board"]
--    }
--    Or update_coop_settings (needs canManageSettings) with
--    volunteerInterests:
--    ["flyers", "stands", "workshops", "technical", "admin", "board"].
--    Rename and the settings replace do not rewrite existing sign-ups.
-- 3. For each status PENDING_CONFIRMATION, ACTIVE and WITHDRAWN, call
--    list_volunteers with tag "technisch" and again with tag "administratie"
--    (page through pageSize 100). For each row, update_volunteer with tags
--    equal to that row's interests after technisch -> technical and
--    administratie -> admin, order kept, case-insensitive duplicates removed.
--    Tags must already be on the form, so do step 2 first.

BEGIN;

DO $$
DECLARE
  coop_id text;
  current_tags text[];
  expected text[] := ARRAY['flyers', 'stands', 'workshops', 'technisch', 'administratie'];
  target text[] := ARRAY['flyers', 'stands', 'workshops', 'technical', 'admin', 'board'];
  remapped integer;
BEGIN
  SELECT id, "volunteerInterests"
    INTO coop_id, current_tags
  FROM coops
  WHERE slug = 'bronsgroen'
  FOR UPDATE;

  IF coop_id IS NULL THEN
    RAISE EXCEPTION 'coop slug bronsgroen was not found; nothing was changed';
  END IF;

  IF current_tags IS DISTINCT FROM expected AND current_tags IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'bronsgroen volunteerInterests is %, expected % or %', current_tags, expected, target;
  END IF;

  UPDATE coops
  SET "volunteerInterests" = target,
      "updatedAt" = NOW()
  WHERE id = coop_id
    AND "volunteerInterests" IS DISTINCT FROM target;

  UPDATE volunteers AS v
  SET interests = (
        SELECT COALESCE(ARRAY(
          SELECT mapped
          FROM (
            SELECT DISTINCT ON (lower(mapped)) mapped, ord
            FROM (
              SELECT CASE lower(btrim(tag))
                       WHEN 'technisch' THEN 'technical'
                       WHEN 'administratie' THEN 'admin'
                       ELSE btrim(tag)
                     END AS mapped,
                     ord::integer AS ord
              FROM unnest(v.interests) WITH ORDINALITY AS u(tag, ord)
            ) AS raw
            ORDER BY lower(mapped), ord
          ) AS deduped
          ORDER BY ord
        ), ARRAY[]::text[])
      ),
      "updatedAt" = NOW()
  WHERE v."coopId" = coop_id
    AND EXISTS (
      SELECT 1
      FROM unnest(v.interests) AS tag
      WHERE lower(btrim(tag)) IN ('technisch', 'administratie')
    );

  GET DIAGNOSTICS remapped = ROW_COUNT;
  RAISE NOTICE 'bronsgroen volunteerInterests is now %. Remapped % signup row(s).', target, remapped;
END $$;

COMMIT;
