-- Migration: Replace get_app_config with check_invite_code
-- Problem: Migration 010 revoked EXECUTE on get_app_config from anon/authenticated,
--   but RLS policy expressions run as the calling role (not the function/table owner).
--   SECURITY DEFINER elevates privileges inside the function body, but the caller still
--   needs EXECUTE to invoke it. Result: every signup fails with 42501 / "permission denied
--   for get_app_config", which the client maps to "Invalid invite code".
-- Fix: Replace the value-returning getter with a boolean check function. anon can EXECUTE
--   it (needed for the RLS policy), but RPC callers can only test candidates, never read
--   the stored code.

DROP POLICY IF EXISTS "vaults_insert_with_invite" ON vaults;
DROP FUNCTION IF EXISTS get_app_config(TEXT);

CREATE OR REPLACE FUNCTION check_invite_code(code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_config
    WHERE key = 'invite_code' AND value = code
  );
$$;

REVOKE EXECUTE ON FUNCTION check_invite_code(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION check_invite_code(TEXT) TO anon, authenticated;

CREATE POLICY "vaults_insert_with_invite" ON vaults
  FOR INSERT
  WITH CHECK (
    check_invite_code(current_setting('request.headers', true)::json->>'x-invite-code')
  );
