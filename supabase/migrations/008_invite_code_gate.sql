-- Migration: Temporary Invite Code Gate
-- Purpose: Prevent unauthorized vault creation during public vetting period
-- Removal: Drop table, drop policy, recreate vaults_insert_public with WITH CHECK (true)
-- After running this migration, INSERT the invite code:
--   INSERT INTO app_config (key, value) VALUES ('invite_code', 'your-code-here');

-- Config table for app settings (not exposed via PostgREST API)
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- RLS: deny all access via API (only accessible in SQL/policy context)
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
-- No policies = no API access. Only SECURITY DEFINER functions and policy expressions can read it.

-- Replace open INSERT policy with invite-code-gated policy
DROP POLICY IF EXISTS "vaults_insert_public" ON vaults;

CREATE POLICY "vaults_insert_with_invite" ON vaults
  FOR INSERT
  WITH CHECK (
    current_setting('request.headers', true)::json->>'x-invite-code'
    = (SELECT value FROM app_config WHERE key = 'invite_code')
  );
