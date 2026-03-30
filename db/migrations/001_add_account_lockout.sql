-- Migration: Add account lockout columns to attorneys table
-- Date: 2026-03-30
-- Description: Adds failed_login_attempts and locked_until columns for brute-force protection

ALTER TABLE attorneys ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE attorneys ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- Create index for efficient lockout checks
CREATE INDEX IF NOT EXISTS idx_attorneys_lockout ON attorneys (locked_until) WHERE locked_until IS NOT NULL;
