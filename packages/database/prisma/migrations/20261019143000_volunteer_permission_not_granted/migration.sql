-- Undo the automatic grant from 20261019120000_volunteer_registration.
-- canViewVolunteers stays a real permission and can be assigned on a role.
-- It is not given to people who already have the Admin role. A missing key
-- is denied. Idempotent.

UPDATE "coop_roles"
SET "permissions" = "permissions" - 'canViewVolunteers'
WHERE "name" = 'Admin'
  AND ("permissions" ->> 'canViewVolunteers') = 'true';
