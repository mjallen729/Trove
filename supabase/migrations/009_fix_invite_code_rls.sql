-- Migration: Fix invite code RLS bypass
-- Problem: The vaults_insert_with_invite policy subqueries app_config,
--   but app_config has RLS enabled with no policies. PostgreSQL enforces
--   RLS on subqueries within policy expressions, so the subquery always
--   returns NULL and the invite code check always fails.
-- Fix: Use a SECURITY DEFINER function to read app_config, bypassing RLS.

CREATE OR REPLACE FUNCTION get_app_config(config_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT value FROM app_config WHERE key = config_key;
$$;

-- Recreate the policy using the function instead of a direct subquery
DROP POLICY IF EXISTS "vaults_insert_with_invite" ON vaults;

CREATE POLICY "vaults_insert_with_invite" ON vaults
  FOR INSERT
  WITH CHECK (
    current_setting('request.headers', true)::json->>'x-invite-code'
    = get_app_config('invite_code')
  );
