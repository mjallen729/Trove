-- Trove Initial Schema
-- Zero-knowledge encrypted cloud storage

-- Main vault storage
CREATE TABLE IF NOT EXISTS vaults (
  uid TEXT PRIMARY KEY,                    -- Hash derived from seed phrase
  manifest_cipher BYTEA NOT NULL,          -- Encrypted vault manifest (nonce prepended)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  burn_at TIMESTAMPTZ,                     -- When to auto-delete (NULL = never)
  storage_used BIGINT DEFAULT 0,           -- Bytes used
  storage_limit BIGINT DEFAULT 5368709120  -- 5GB default limit
);

-- Track in-progress uploads for resume capability
CREATE TABLE IF NOT EXISTS uploads (
  upload_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_uid TEXT NOT NULL REFERENCES vaults(uid) ON DELETE CASCADE,
  file_uid UUID NOT NULL,
  file_name_encrypted BYTEA,               -- Encrypted filename for resume UI
  total_chunks INTEGER NOT NULL,
  received_chunks INTEGER[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Storage purchase transactions (v2 - payments, deferred)
CREATE TABLE IF NOT EXISTS storage_transacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_uid TEXT NOT NULL,
  vault_uid TEXT NOT NULL REFERENCES vaults(uid) ON DELETE CASCADE,
  storage_gb INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_uploads_vault ON uploads(vault_uid);
CREATE INDEX IF NOT EXISTS idx_uploads_file ON uploads(file_uid);
CREATE INDEX IF NOT EXISTS idx_storage_vault ON storage_transacts(vault_uid);
CREATE INDEX IF NOT EXISTS idx_vaults_burn ON vaults(burn_at) WHERE burn_at IS NOT NULL;

-- Enable Row Level Security on all tables
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_transacts ENABLE ROW LEVEL SECURITY;

-- RLS Policies using x-vault-uid header
-- Note: The header is accessed via current_setting('request.headers', true)::json->>'x-vault-uid'

-- Vaults: Allow INSERT without header (for vault creation)
CREATE POLICY "vaults_insert_public" ON vaults
  FOR INSERT
  WITH CHECK (true);

-- Vaults: SELECT/UPDATE/DELETE require matching header
CREATE POLICY "vaults_select_by_header" ON vaults
  FOR SELECT
  USING (uid = current_setting('request.headers', true)::json->>'x-vault-uid');

CREATE POLICY "vaults_update_by_header" ON vaults
  FOR UPDATE
  USING (uid = current_setting('request.headers', true)::json->>'x-vault-uid');

CREATE POLICY "vaults_delete_by_header" ON vaults
  FOR DELETE
  USING (uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- Uploads: Full access by vault_uid header
CREATE POLICY "uploads_all_by_header" ON uploads
  FOR ALL
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- Storage transacts: Full access by vault_uid header
CREATE POLICY "transacts_all_by_header" ON storage_transacts
  FOR ALL
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- Helper function to append chunk index to received_chunks array
CREATE OR REPLACE FUNCTION append_received_chunk(
  p_file_uid UUID,
  p_chunk_index INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE uploads
  SET received_chunks = array_append(received_chunks, p_chunk_index)
  WHERE file_uid = p_file_uid
    AND NOT (p_chunk_index = ANY(received_chunks));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: pg_cron for burn timer requires manual setup in Supabase dashboard
-- The following would be run manually or via Supabase dashboard:
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- SELECT cron.schedule(
--   'burn-expired-vaults',
--   '0 * * * *',  -- Every hour at minute 0
--   $$DELETE FROM vaults WHERE burn_at IS NOT NULL AND burn_at <= NOW()$$
-- );
