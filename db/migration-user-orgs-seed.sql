-- Populate user_organisations from existing users.org_id
-- Run once after creating the user_organisations table
INSERT INTO user_organisations (user_id, org_id, role)
SELECT id, org_id, role
FROM users
WHERE org_id IS NOT NULL
ON CONFLICT (user_id, org_id) DO NOTHING;
