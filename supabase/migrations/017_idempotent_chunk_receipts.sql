-- Migration: Idempotent chunk receipts
-- Problem: append_received_chunk raised when the index was already recorded,
--   so a retried chunk (object stored, receipt lost) failed the whole upload.
-- Fix: A repeat receipt is a no-op. Only a missing upload row or a
--   non-writable session raises. CREATE OR REPLACE keeps the existing grants.

CREATE OR REPLACE FUNCTION append_received_chunk(
  p_file_uid UUID,
  p_chunk_index INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE public.uploads
  SET received_chunks = CASE
        WHEN p_chunk_index = ANY(received_chunks) THEN received_chunks
        ELSE array_append(received_chunks, p_chunk_index)
      END
  WHERE file_uid = p_file_uid
    AND vault_uid = public.session_can_write(
      current_setting('request.headers', true)::json->>'x-vault-token'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload not found or session is not writable'
      USING ERRCODE = '42501';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
