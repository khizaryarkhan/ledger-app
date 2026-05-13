-- Backfill user_organisations for users created before the junction-row insert
-- was added to the user-creation and rep-login endpoints.
--
-- Symptom this fixes: company-admin-created users and reps with logins could
-- authenticate but every API call returned 403 because requireOrg() checks
-- user_organisations for membership.
--
-- This statement inserts one row per (user, primary org) pair where the user
-- already has a users.org_id but no matching junction row. Idempotent.

INSERT INTO user_organisations (user_id, org_id, role)
SELECT u.id, u.org_id, u.role
FROM users u
WHERE u.org_id IS NOT NULL
  AND u.role != 'super_admin'
  AND NOT EXISTS (
    SELECT 1
    FROM user_organisations uo
    WHERE uo.user_id = u.id AND uo.org_id = u.org_id
  );
