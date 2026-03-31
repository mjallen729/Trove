-- Migration: Security Lint Fixes
-- 1. Set search_path on all SECURITY DEFINER functions to prevent search path manipulation
-- 2. Tighten storage_transacts INSERT policy to require vault_uid header

-- Fix 1: append_received_chunk - add search_path
CREATE OR REPLACE FUNCTION append_received_chunk(
  p_file_uid UUID,
  p_chunk_index INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE public.uploads
  SET received_chunks = array_append(received_chunks, p_chunk_index)
  WHERE file_uid = p_file_uid
    AND NOT (p_chunk_index = ANY(received_chunks));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Fix 2: cleanup_expired_sessions - add search_path
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.vault_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Fix 3: validate_storage_session - add search_path
CREATE OR REPLACE FUNCTION validate_storage_session(raw_token TEXT)
RETURNS TEXT AS $$
  SELECT vault_uid
  FROM public.vault_sessions
  WHERE public.vault_sessions.token_hash = encode(sha256(decode(raw_token, 'hex')), 'hex')
    AND expires_at > NOW()
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = '';

-- Fix 4: Tighten storage_transacts INSERT policy
-- Replace permissive WITH CHECK (true) with vault_uid header check
DROP POLICY IF EXISTS "transacts_insert_public" ON storage_transacts;

CREATE POLICY "transacts_insert_by_header" ON storage_transacts
  FOR INSERT
  WITH CHECK (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');
