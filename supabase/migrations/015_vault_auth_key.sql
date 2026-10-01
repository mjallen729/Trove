-- Migration: Seed-Derived Vault Auth Key
-- Problem: create_vault_session (014) needs only the x-vault-uid header, so anyone
--   who learns a vault UID gets a session: full write access on vaults with no
--   edit password, ciphertext reads on all vaults. vaults/uploads SELECT,
--   storage_transacts, and vault_sessions DELETE also trust the header alone.
-- Fix: Clients derive a third KDF subkey (the auth key) from the seed phrase and
--   store sha256(auth key) on the vault at creation. create_vault_session now
--   requires the auth key, and every remaining header-only policy requires a live
--   session. The vault UID becomes a lookup ID, not a credential.
--   The auth key is 256 bits of entropy, so a fast hash is sufficient.
-- Requires: existing vaults wiped before applying (auth_key_hash is NOT NULL).

-- Part A: Auth key hash on vaults
ALTER TABLE vaults ADD COLUMN auth_key_hash TEXT NOT NULL;

-- Clients may only update the manifest and storage counter. Closes direct writes
-- to auth_key_hash, storage_limit, burn_at, and uid.
REVOKE UPDATE ON vaults FROM anon, authenticated;
GRANT UPDATE (manifest_cipher, storage_used) ON vaults TO anon, authenticated;

-- Part B: Session creation requires the auth key
-- Same error for unknown vault and wrong key (no existence disclosure).
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

REVOKE EXECUTE ON FUNCTION create_vault_session(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION create_vault_session(TEXT, TEXT) TO anon, authenticated;

-- The one-argument version from 014 must not remain callable
DROP FUNCTION IF EXISTS create_vault_session(TEXT);

-- Part C: Reads require a live session
DROP POLICY IF EXISTS "vaults_select_by_header" ON vaults;
CREATE POLICY "vaults_select_with_session" ON vaults
  FOR SELECT
  USING (
    validate_storage_session(current_setting('request.headers', true)::json->>'x-vault-token') = uid
  );

DROP POLICY IF EXISTS "uploads_select_by_header" ON uploads;
CREATE POLICY "uploads_select_with_session" ON uploads
  FOR SELECT
  USING (
    validate_storage_session(current_setting('request.headers', true)::json->>'x-vault-token') = vault_uid
  );

-- Part D: storage_transacts becomes server-written only
-- The free allocation row is created by trigger instead of by the client.
DROP POLICY IF EXISTS "transacts_select_by_header" ON storage_transacts;
DROP POLICY IF EXISTS "transacts_insert_by_header" ON storage_transacts;
DROP POLICY IF EXISTS "transacts_update_by_header" ON storage_transacts;
DROP POLICY IF EXISTS "transacts_delete_by_header" ON storage_transacts;

CREATE POLICY "transacts_select_with_session" ON storage_transacts
  FOR SELECT
  USING (
    validate_storage_session(current_setting('request.headers', true)::json->>'x-vault-token') = vault_uid
  );

CREATE OR REPLACE FUNCTION create_free_storage_transact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.storage_transacts (transaction_uid, vault_uid, storage_bytes, previous_transact)
  VALUES ('free-' || left(NEW.uid, 16), NEW.uid, 1000000000, NULL);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_free_storage_transact() FROM public;

CREATE TRIGGER vaults_create_free_storage
  AFTER INSERT ON vaults
  FOR EACH ROW EXECUTE FUNCTION create_free_storage_transact();

-- Part E: Sessions are visible and deletable only by their own token holder
DROP POLICY IF EXISTS "sessions_select_by_header" ON vault_sessions;
DROP POLICY IF EXISTS "sessions_delete_by_header" ON vault_sessions;

CREATE POLICY "sessions_select_own" ON vault_sessions
  FOR SELECT
  USING (
    token_hash = encode(sha256(decode(
      current_setting('request.headers', true)::json->>'x-vault-token', 'hex'
    )), 'hex')
  );

CREATE POLICY "sessions_delete_own" ON vault_sessions
  FOR DELETE
  USING (
    token_hash = encode(sha256(decode(
      current_setting('request.headers', true)::json->>'x-vault-token', 'hex'
    )), 'hex')
  );
