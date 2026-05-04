-- Backfill the new `canManageMeetings` permission on every existing
-- CoopRole. Today's meetings controller has no permission gate, so every
-- coop admin already has full meeting-admin power — set the new key to
-- `true` everywhere to preserve that behavior. Coop admins can later edit
-- specific roles (e.g. "Viewer") to drop meeting access.
--
-- Idempotent: only updates rows where the key is missing.
UPDATE "coop_roles"
SET "permissions" = "permissions" || jsonb_build_object('canManageMeetings', true)
WHERE NOT ("permissions" ? 'canManageMeetings');
