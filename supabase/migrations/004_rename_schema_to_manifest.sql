-- Rename schema_cipher column to manifest_cipher
ALTER TABLE vaults RENAME COLUMN schema_cipher TO manifest_cipher;
