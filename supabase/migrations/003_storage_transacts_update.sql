-- Migration: Update storage_transacts table
-- 1. Rename storage_gb to storage_bytes (use bytes instead of GB)
-- 2. Add previous_transact column for transaction chaining

-- Rename column and change type to BIGINT for bytes
ALTER TABLE storage_transacts
  ALTER COLUMN storage_gb TYPE BIGINT;

ALTER TABLE storage_transacts
  RENAME COLUMN storage_gb TO storage_bytes;

-- Add previous_transact column (self-referencing for transaction chain)
ALTER TABLE storage_transacts
  ADD COLUMN previous_transact UUID REFERENCES storage_transacts(id);

-- Add index for faster lookups on previous_transact
CREATE INDEX idx_storage_previous ON storage_transacts(previous_transact);

-- Update RLS policy to allow INSERT for new vaults
-- The existing policy only works with header, but we need to allow inserts
-- when creating the initial free storage transaction
DROP POLICY IF EXISTS "transacts_all_by_header" ON storage_transacts;

-- Allow SELECT/UPDATE/DELETE by header
CREATE POLICY "transacts_select_by_header" ON storage_transacts
  FOR SELECT
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

CREATE POLICY "transacts_update_by_header" ON storage_transacts
  FOR UPDATE
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

CREATE POLICY "transacts_delete_by_header" ON storage_transacts
  FOR DELETE
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- Allow INSERT publicly (for vault creation with free storage)
-- Sanity checks will be added after payment logic implementation
CREATE POLICY "transacts_insert_public" ON storage_transacts
  FOR INSERT
  WITH CHECK (true);
