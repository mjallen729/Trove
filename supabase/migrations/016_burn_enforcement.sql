-- Migration: Burn Timer Enforcement
-- Problem: The burn job from 002 reads app.settings.* values that cannot be set on
--   hosted Supabase, so it never calls the cleanup function. Separately, nothing
--   checks burn_at on access: a burned vault stays readable until the cron
--   physically deletes it.
-- Fix: Every session check now also requires an unburned vault, so access ends at
--   burn_at exactly; the cron only handles physical deletion. The job is
--   rescheduled to read its URL and a dedicated shared secret from Supabase Vault.
-- Requires: Vault secrets 'project_url' and 'cron_secret', and the same secret set
--   as CRON_SECRET on the cleanup-burned-vaults Edge Function.

-- Part A: Session validators reject burned vaults
-- CREATE OR REPLACE keeps the existing grants. Every RLS policy and session RPC
-- goes through one of these three functions.
CREATE OR REPLACE FUNCTION validate_storage_session(raw_token TEXT)
RETURNS TEXT AS $$
  SELECT s.vault_uid
  FROM public.vault_sessions s
  JOIN public.vaults v ON v.uid = s.vault_uid
  WHERE s.token_hash = encode(sha256(decode(raw_token, 'hex')), 'hex')
    AND s.expires_at > NOW()
    AND (v.burn_at IS NULL OR v.burn_at > NOW())
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION session_can_write(raw_token TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT s.vault_uid
  FROM public.vault_sessions s
  JOIN public.vaults v ON v.uid = s.vault_uid
  WHERE s.token_hash = encode(sha256(decode(raw_token, 'hex')), 'hex')
    AND s.expires_at > NOW()
    AND s.can_write
    AND (v.burn_at IS NULL OR v.burn_at > NOW())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION current_vault_session()
RETURNS public.vault_sessions
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := current_setting('request.headers', true)::json->>'x-vault-uid';
  v_token TEXT := current_setting('request.headers', true)::json->>'x-vault-token';
  v_session public.vault_sessions;
BEGIN
  IF v_uid IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'Missing vault headers' USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_session
  FROM public.vault_sessions s
  JOIN public.vaults v ON v.uid = s.vault_uid
  WHERE s.token_hash = encode(sha256(decode(v_token, 'hex')), 'hex')
    AND s.expires_at > NOW()
    AND (v.burn_at IS NULL OR v.burn_at > NOW())
  LIMIT 1;

  IF NOT FOUND OR v_session.vault_uid <> v_uid THEN
    RAISE EXCEPTION 'Invalid session' USING ERRCODE = '42501';
  END IF;

  RETURN v_session;
END;
$$;

-- Part B: No new sessions for burned vaults
-- Same error as unknown vault / wrong key (no disclosure that the vault burned).
CREATE OR REPLACE FUNCTION create_vault_session(p_token_hash TEXT, p_auth_key TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := current_setting('request.headers', true)::json->>'x-vault-uid';
  v_has_pw BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Missing vault header' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_auth_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid request';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vaults
    WHERE uid = v_uid
      AND auth_key_hash = encode(sha256(decode(p_auth_key, 'hex')), 'hex')
      AND (burn_at IS NULL OR burn_at > NOW())
  ) THEN
    RAISE EXCEPTION 'Unable to access vault' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vault_edit_passwords WHERE vault_uid = v_uid
  ) INTO v_has_pw;

  INSERT INTO public.vault_sessions (vault_uid, token_hash, expires_at, can_write)
  VALUES (v_uid, p_token_hash, NOW() + interval '1 hour', NOT v_has_pw);

  RETURN json_build_object('can_write', NOT v_has_pw, 'has_edit_password', v_has_pw);
END;
$$;

-- Part C: Reschedule the cleanup job
-- Same job name as 002, so this replaces that job's command if it exists.
-- Secrets are read at run time; a missing secret fails the run (see
-- cron.job_run_details) instead of calling the function unauthenticated.
SELECT cron.schedule(
  'cleanup-burned-vaults',
  '0 * * * *',  -- Run at minute 0 of every hour
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
      || '/functions/v1/cleanup-burned-vaults',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
