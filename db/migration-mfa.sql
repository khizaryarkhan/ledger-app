-- Super-admin TOTP multi-factor auth. Run on Neon.
-- Adds opt-in MFA columns to users. Existing rows default to disabled, so this
-- changes nothing for anyone until they enrol. mfa_secret is stored encrypted
-- (lib/crypto); mfa_recovery_codes holds bcrypt hashes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled        boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret         text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_codes jsonb DEFAULT '[]'::jsonb;
