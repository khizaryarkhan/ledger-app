-- Run this in your Neon SQL editor to add the QBO tokens table
-- Go to: console.neon.tech → your project → SQL Editor → paste and run

CREATE TABLE IF NOT EXISTS qbo_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  realm_id VARCHAR(64) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP NOT NULL,
  refresh_token_expires_at TIMESTAMP NOT NULL,
  company_name VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS qbo_tokens_user_id_idx ON qbo_tokens(user_id);

-- Gmail tokens table
CREATE TABLE IF NOT EXISTS gmail_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gmail_tokens_user_id_idx ON gmail_tokens(user_id);
