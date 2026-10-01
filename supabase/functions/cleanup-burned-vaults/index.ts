// Supabase Edge Function to cleanup burned vaults
// Called hourly by pg_cron (see migration 016), authenticated by CRON_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Objects listed and removed per storage call
const STORAGE_BATCH_SIZE = 1000;

interface BurnedVault {
  uid: string;
}

// Constant-time string comparison for the shared secret
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify this is an authorized request (pg_cron sends the shared secret).
    // JWT verification is off for this function, so this is the only gate.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const providedSecret = req.headers.get("x-cron-secret");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (
      !cronSecret ||
      !providedSecret ||
      !timingSafeEqual(providedSecret, cronSecret)
    ) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Find all vaults that have passed their burn_at time
    const { data: burnedVaults, error: fetchError } = await supabase
      .from("vaults")
      .select("uid")
      .not("burn_at", "is", null)
      .lte("burn_at", new Date().toISOString());

    if (fetchError) {
      throw new Error(`Failed to fetch burned vaults: ${fetchError.message}`);
    }

    if (!burnedVaults || burnedVaults.length === 0) {
      return new Response(
        JSON.stringify({ message: "No vaults to cleanup", cleaned: 0 }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const cleanedVaults: string[] = [];
    const errors: string[] = [];

    for (const vault of burnedVaults as BurnedVault[]) {
      try {
        // Delete all files in the vault's storage folder. list() is paginated,
        // so keep listing from the start until the folder is empty. The vault
        // record is only deleted once every blob is gone; otherwise the
        // remaining blobs could never be found again.
        let storageError: string | null = null;
        while (true) {
          const { data: files, error: listError } = await supabase.storage
            .from("vault_files")
            .list(vault.uid, { limit: STORAGE_BATCH_SIZE });

          if (listError) {
            storageError = `Failed to list files for vault ${vault.uid}: ${listError.message}`;
            break;
          }

          if (!files || files.length === 0) break;

          const filePaths = files.map((f) => `${vault.uid}/${f.name}`);
          const { data: removed, error: deleteError } = await supabase.storage
            .from("vault_files")
            .remove(filePaths);

          // An empty result with no error would loop forever
          if (deleteError || !removed || removed.length === 0) {
            storageError = `Failed to delete files for vault ${vault.uid}: ${
              deleteError?.message ?? "no files removed"
            }`;
            break;
          }
        }

        if (storageError) {
          errors.push(storageError);
          continue;
        }

        // Delete any pending uploads for this vault
        await supabase.from("uploads").delete().eq("vault_uid", vault.uid);

        // Delete the vault record (this will cascade delete related records)
        const { error: vaultDeleteError } = await supabase
          .from("vaults")
          .delete()
          .eq("uid", vault.uid);

        if (vaultDeleteError) {
          errors.push(
            `Failed to delete vault ${vault.uid}: ${vaultDeleteError.message}`
          );
          continue;
        }

        cleanedVaults.push(vault.uid);
      } catch (err) {
        errors.push(`Error processing vault ${vault.uid}: ${err}`);
      }
    }

    return new Response(
      JSON.stringify({
        message: `Cleanup completed`,
        cleaned: cleanedVaults.length,
        cleanedVaults,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
