-- Migration: add show_payment_history to organisations
-- Run in Neon SQL editor (or your Postgres client)

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS show_payment_history boolean NOT NULL DEFAULT false;
