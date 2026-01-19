-- Migration: Fix Session Token Validation
-- Fixes hash algorithm mismatch: client uses SHA-256, server now matches

-- Part A: Drop existing storage policies
-- First drop dashboard-created policies
DROP POLICY IF EXISTS "vault_files_select" ON storage.objects;
DROP POLICY IF EXISTS "vault_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "vault_files_delete" ON storage.objects;
-- Then drop migration-005-created policies (depend on the function we need to drop)
DROP POLICY IF EXISTS "storage_insert_with_session" ON storage.objects;
DROP POLICY IF EXISTS "storage_select_with_session" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_with_session" ON storage.objects;

-- Part B: Update validation function to hash raw token with SHA-256
-- The client sends raw token in x-vault-token header
-- This function decodes hex -> bytes, hashes with SHA-256, compares to stored hash
-- Must DROP first because PostgreSQL doesn't allow changing parameter names
DROP FUNCTION IF EXISTS validate_storage_session(TEXT);

CREATE FUNCTION validate_storage_session(raw_token TEXT)
RETURNS TEXT AS $$
  SELECT vault_uid
  FROM vault_sessions
  WHERE vault_sessions.token_hash = encode(sha256(decode(raw_token, 'hex')), 'hex')
    AND expires_at > NOW()
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Part C: Create storage policies using session validation
-- Path structure: {vault_uid}/{chunk_uid}

-- Storage policy: Allow upload if session token is valid and matches vault_uid in path
CREATE POLICY "storage_insert_with_session" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'vault_files' AND
    validate_storage_session(
      current_setting('request.headers', true)::json->>'x-vault-token'
    ) = (storage.foldername(name))[1]
  );

-- Storage policy: Allow download if session token is valid and matches vault_uid in path
CREATE POLICY "storage_select_with_session" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'vault_files' AND
    validate_storage_session(
      current_setting('request.headers', true)::json->>'x-vault-token'
    ) = (storage.foldername(name))[1]
  );

-- Storage policy: Allow delete if session token is valid and matches vault_uid in path
CREATE POLICY "storage_delete_with_session" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'vault_files' AND
    validate_storage_session(
      current_setting('request.headers', true)::json->>'x-vault-token'
    ) = (storage.foldername(name))[1]
  );
