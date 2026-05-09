-- Migration: add home currency to organisations
-- Run once against your database.
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'EUR';
