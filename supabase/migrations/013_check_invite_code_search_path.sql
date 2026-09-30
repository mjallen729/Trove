-- Migration: Pin search_path on check_invite_code
-- Problem: check_invite_code (011) is SECURITY DEFINER without a fixed search_path,
--   unlike the functions hardened in 007. Flagged by the Supabase security linter.
-- Fix: Recreate with SET search_path = '' and a schema-qualified table reference.
--   CREATE OR REPLACE preserves existing grants and the dependent RLS policy.

CREATE OR REPLACE FUNCTION check_invite_code(code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_config
    WHERE key = 'invite_code' AND value = code
  );
$$;
