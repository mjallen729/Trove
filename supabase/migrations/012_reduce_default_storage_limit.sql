-- Reduce default free storage allowance from 5GB to 1GB for new vaults.
-- Existing vaults are intentionally not updated -- they keep their current limit.
ALTER TABLE vaults ALTER COLUMN storage_limit SET DEFAULT 1000000000;
