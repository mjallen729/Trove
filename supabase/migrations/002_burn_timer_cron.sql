-- Burn Timer Cleanup Cron Job
-- This migration sets up a pg_cron job to call the cleanup Edge Function
--
-- IMPORTANT: pg_cron and pg_net extensions must be enabled in your Supabase project
-- This can be done via the Supabase dashboard under Database > Extensions
--
-- The Edge Function (cleanup-burned-vaults) must be deployed before this runs.

-- Enable required extensions (may need to be enabled via Supabase dashboard first)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the cleanup job to run every hour
-- This calls the Edge Function which handles both:
-- 1. Deleting blob storage files
-- 2. Deleting the vault record from the database
SELECT cron.schedule(
  'cleanup-burned-vaults',
  '0 * * * *',  -- Run at minute 0 of every hour
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/cleanup-burned-vaults',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json',
      'x-supabase-internal', 'true'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Alternative: Direct database deletion (simpler, but doesn't clean up storage blobs)
-- Use this if you prefer to clean up blobs via a separate scheduled task or manually
--
-- SELECT cron.schedule(
--   'burn-expired-vaults-db',
--   '0 * * * *',
--   $$DELETE FROM vaults WHERE burn_at IS NOT NULL AND burn_at <= NOW()$$
-- );

-- Note: To unschedule, run:
-- SELECT cron.unschedule('cleanup-burned-vaults');
