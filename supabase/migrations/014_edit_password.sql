-- Migration: Vault Edit Password
-- Problem: The seed phrase is the only credential. Sharing it for read access also
--   hands over every write, and every write policy trusts only the x-vault-uid
--   header. The vault_sessions INSERT policy trusts it too, so anyone who knows a
--   vault UID can mint a storage session and delete blobs.
-- Fix: Optional per-vault edit password (client Argon2id pre-hash, server bcrypt),
--   stored in a table with no RLS policies so it is reachable only through
--   SECURITY DEFINER functions. Sessions gain a can_write flag, are created only
--   via RPC, and every write policy now requires a writable session. Vaults with
--   no edit password get can_write = true at session creation, so they behave as
--   before.
-- Follow-up: brute-force rate limiting on unlock_vault_edit.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Part A: Edit password storage
-- No RLS policies on purpose (same pattern as app_config): unreachable via the API.
CREATE TABLE IF NOT EXISTS vault_edit_passwords (
  vault_uid TEXT PRIMARY KEY REFERENCES vaults(uid) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vault_edit_passwords ENABLE ROW LEVEL SECURITY;

-- Part B: Session write flag
ALTER TABLE vault_sessions ADD COLUMN IF NOT EXISTS can_write BOOLEAN NOT NULL DEFAULT false;

-- No edit passwords exist yet, so every live session keeps write access
UPDATE vault_sessions SET can_write = true;

-- Sessions are created only through create_vault_session from now on.
-- (There is no UPDATE policy on vault_sessions, so can_write cannot be flipped via the API.)
DROP POLICY IF EXISTS "sessions_insert_by_header" ON vault_sessions;

-- Part C: Write-capable session validator
-- Same as validate_storage_session plus the can_write check. Left with default
-- PUBLIC execute because storage.objects policies call it.
CREATE OR REPLACE FUNCTION session_can_write(raw_token TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT vault_uid
  FROM public.vault_sessions
  WHERE token_hash = encode(sha256(decode(raw_token, 'hex')), 'hex')
    AND expires_at > NOW()
    AND can_write
  LIMIT 1;
$$;

-- Part D: Gate every write policy on a writable session
-- UPDATE gates go in WITH CHECK so a blocked write raises 42501 instead of
-- silently matching zero rows (the client only checks for an error).

-- vaults
DROP POLICY IF EXISTS "vaults_update_by_header" ON vaults;
DROP POLICY IF EXISTS "vaults_delete_by_header" ON vaults;

CREATE POLICY "vaults_update_with_write_session" ON vaults
  FOR UPDATE
  USING (uid = current_setting('request.headers', true)::json->>'x-vault-uid')
  WITH CHECK (
    uid = current_setting('request.headers', true)::json->>'x-vault-uid' AND
    session_can_write(current_setting('request.headers', true)::json->>'x-vault-token') = uid
  );

CREATE POLICY "vaults_delete_with_write_session" ON vaults
  FOR DELETE
  USING (
    session_can_write(current_setting('request.headers', true)::json->>'x-vault-token') = uid
  );

-- uploads
DROP POLICY IF EXISTS "uploads_all_by_header" ON uploads;

CREATE POLICY "uploads_select_by_header" ON uploads
  FOR SELECT
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

CREATE POLICY "uploads_insert_with_write_session" ON uploads
  FOR INSERT
  WITH CHECK (
    session_can_write(current_setting('request.headers', true)::json->>'x-vault-token') = vault_uid
  );

CREATE POLICY "uploads_update_with_write_session" ON uploads
  FOR UPDATE
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid')
  WITH CHECK (
    session_can_write(current_setting('request.headers', true)::json->>'x-vault-token') = vault_uid
  );

CREATE POLICY "uploads_delete_with_write_session" ON uploads
  FOR DELETE
  USING (
    session_can_write(current_setting('request.headers', true)::json->>'x-vault-token') = vault_uid
  );

-- storage.objects (SELECT policy from 006 is unchanged: reads only need a live session)
DROP POLICY IF EXISTS "storage_insert_with_session" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_with_session" ON storage.objects;

CREATE POLICY "storage_insert_with_write_session" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'vault_files' AND
    session_can_write(
      current_setting('request.headers', true)::json->>'x-vault-token'
    ) = (storage.foldername(name))[1]
  );

CREATE POLICY "storage_delete_with_write_session" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'vault_files' AND
    session_can_write(
      current_setting('request.headers', true)::json->>'x-vault-token'
    ) = (storage.foldername(name))[1]
  );

-- append_received_chunk bypasses RLS (SECURITY DEFINER), so it checks ownership itself.
-- CREATE OR REPLACE keeps the existing grants.
CREATE OR REPLACE FUNCTION append_received_chunk(
  p_file_uid UUID,
  p_chunk_index INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE public.uploads
  SET received_chunks = array_append(received_chunks, p_chunk_index)
  WHERE file_uid = p_file_uid
    AND vault_uid = public.session_can_write(
      current_setting('request.headers', true)::json->>'x-vault-token'
    )
    AND NOT (p_chunk_index = ANY(received_chunks));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload not found or session is not writable'
      USING ERRCODE = '42501';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Part E: Session RPCs
-- All read the request headers directly. Callers can only act on the session
-- whose raw token they hold.

-- Look up the live session for the current request, cross-checked against x-vault-uid.
-- Raises if either header is missing or the session is not found.
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

  SELECT * INTO v_session
  FROM public.vault_sessions
  WHERE token_hash = encode(sha256(decode(v_token, 'hex')), 'hex')
    AND expires_at > NOW()
  LIMIT 1;

  IF NOT FOUND OR v_session.vault_uid <> v_uid THEN
    RAISE EXCEPTION 'Invalid session' USING ERRCODE = '42501';
  END IF;

  RETURN v_session;
END;
$$;

REVOKE EXECUTE ON FUNCTION current_vault_session() FROM public;

-- Create a session for the vault in x-vault-uid. Writable unless an edit password exists.
CREATE OR REPLACE FUNCTION create_vault_session(p_token_hash TEXT)
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

  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid token hash';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vault_edit_passwords WHERE vault_uid = v_uid
  ) INTO v_has_pw;

  INSERT INTO public.vault_sessions (vault_uid, token_hash, expires_at, can_write)
  VALUES (v_uid, p_token_hash, NOW() + interval '1 hour', NOT v_has_pw);

  RETURN json_build_object('can_write', NOT v_has_pw, 'has_edit_password', v_has_pw);
END;
$$;

REVOKE EXECUTE ON FUNCTION create_vault_session(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION create_vault_session(TEXT) TO anon, authenticated;

-- Rotate the current session's token in place, keeping can_write.
CREATE OR REPLACE FUNCTION refresh_vault_session(p_new_token_hash TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.vault_sessions := public.current_vault_session();
BEGIN
  IF p_new_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid token hash';
  END IF;

  UPDATE public.vault_sessions
  SET token_hash = p_new_token_hash,
      expires_at = NOW() + interval '1 hour'
  WHERE id = v_session.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION refresh_vault_session(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION refresh_vault_session(TEXT) TO anon, authenticated;

-- Verify the edit password and make the current session writable.
-- Returns false on a wrong password. Callers only ever learn pass/fail.
CREATE OR REPLACE FUNCTION unlock_vault_edit(p_password_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.vault_sessions := public.current_vault_session();
  v_stored TEXT;
BEGIN
  IF p_password_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid password hash';
  END IF;

  SELECT password_hash INTO v_stored
  FROM public.vault_edit_passwords
  WHERE vault_uid = v_session.vault_uid;

  -- No edit password: the vault is writable by definition
  IF NOT FOUND OR extensions.crypt(p_password_hash, v_stored) = v_stored THEN
    UPDATE public.vault_sessions SET can_write = true WHERE id = v_session.id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION unlock_vault_edit(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION unlock_vault_edit(TEXT) TO anon, authenticated;

-- Drop the current session back to read-only (no-op if the vault has no edit password).
CREATE OR REPLACE FUNCTION lock_vault_edit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.vault_sessions := public.current_vault_session();
BEGIN
  UPDATE public.vault_sessions
  SET can_write = false
  WHERE id = v_session.id
    AND EXISTS (
      SELECT 1 FROM public.vault_edit_passwords WHERE vault_uid = v_session.vault_uid
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION lock_vault_edit() FROM public;
GRANT EXECUTE ON FUNCTION lock_vault_edit() TO anon, authenticated;

-- Set the edit password for the first time. Requires a writable session.
-- Every other live session for the vault is demoted to read-only.
CREATE OR REPLACE FUNCTION set_edit_password(p_password_hash TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.vault_sessions := public.current_vault_session();
BEGIN
  IF p_password_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid password hash';
  END IF;

  IF NOT v_session.can_write THEN
    RAISE EXCEPTION 'Session is not writable' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vault_edit_passwords WHERE vault_uid = v_session.vault_uid
  ) THEN
    RAISE EXCEPTION 'Edit password already set';
  END IF;

  INSERT INTO public.vault_edit_passwords (vault_uid, password_hash)
  VALUES (
    v_session.vault_uid,
    extensions.crypt(p_password_hash, extensions.gen_salt('bf', 10))
  );

  UPDATE public.vault_sessions
  SET can_write = false
  WHERE vault_uid = v_session.vault_uid
    AND id <> v_session.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_edit_password(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION set_edit_password(TEXT) TO anon, authenticated;
