-- Migration: Revoke public access to get_app_config()
-- Problem: get_app_config() is a SECURITY DEFINER function in the public schema,
--   meaning anyone can call it via supabase.rpc() to read the invite code.
-- Fix: Revoke EXECUTE from API-facing roles. The vaults RLS policy still works
--   because policy expressions run as the table owner, not the calling role.

REVOKE EXECUTE ON FUNCTION get_app_config(TEXT) FROM anon, authenticated, public;
