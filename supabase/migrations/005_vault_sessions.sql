-- Migration: Vault Sessions for Storage Access Control
-- Adds session-based authentication for storage operations to prevent
-- unauthorized access even if vault_uid is compromised

-- Create vault_sessions table
CREATE TABLE IF NOT EXISTS vault_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_uid TEXT NOT NULL REFERENCES vaults(uid) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hash of the session token
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vault_sessions_token ON vault_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_vault_sessions_vault ON vault_sessions(vault_uid);
CREATE INDEX IF NOT EXISTS idx_vault_sessions_expires ON vault_sessions(expires_at);

-- Enable RLS
ALTER TABLE vault_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vault_sessions
-- INSERT: Allow if vault_uid matches header (only vault owner can create sessions)
CREATE POLICY "sessions_insert_by_header" ON vault_sessions
  FOR INSERT
  WITH CHECK (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- SELECT: Allow if vault_uid matches header
CREATE POLICY "sessions_select_by_header" ON vault_sessions
  FOR SELECT
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- DELETE: Allow if vault_uid matches header (for logout/cleanup)
CREATE POLICY "sessions_delete_by_header" ON vault_sessions
  FOR DELETE
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- Function to validate a session token for storage access
-- Takes token_hash and validates against stored hash
-- Returns the vault_uid if token is valid, NULL otherwise
CREATE OR REPLACE FUNCTION validate_storage_session(token_hash TEXT)
RETURNS TEXT AS $$
  SELECT vault_uid
  FROM vault_sessions
  WHERE vault_sessions.token_hash = $1
    AND expires_at > NOW()
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Function to cleanup expired sessions (can be called by cron)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM vault_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Storage bucket policies
-- These policies control access to the vault_files bucket
-- Path structure: {vault_uid}/{chunk_uid}

-- First, ensure the bucket exists and is private
-- Note: Bucket creation is typically done via Supabase dashboard or seed script
-- INSERT INTO storage.buckets (id, name, public) VALUES ('vault_files', 'vault_files', false)
-- ON CONFLICT (id) DO UPDATE SET public = false;

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

-- Storage policy: Allow service role full access (for cleanup function)
CREATE POLICY "storage_service_role_all" ON storage.objects
  FOR ALL
  USING (auth.role() = 'service_role');

-- Add scheduled job to cleanup expired sessions (runs hourly)
-- Note: Requires pg_cron extension to be enabled
-- SELECT cron.schedule(
--   'cleanup-expired-sessions',
--   '30 * * * *',  -- Every hour at minute 30
--   $$SELECT cleanup_expired_sessions()$$
-- );
