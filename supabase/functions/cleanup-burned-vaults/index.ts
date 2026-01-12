// Supabase Edge Function to cleanup burned vaults
// This function should be called periodically via pg_cron or external scheduler

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface BurnedVault {
  uid: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify this is an authorized request (from pg_cron or with service key)
    const authHeader = req.headers.get("authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Only allow service role key or internal pg_cron calls
    if (!authHeader?.includes(serviceRoleKey ?? "")) {
      // Check if this is an internal call (e.g., from pg_cron via pg_net)
      const isInternalCall = req.headers.get("x-supabase-internal") === "true";
      if (!isInternalCall && !authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
      .lt("burn_at", new Date().toISOString());

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
        // List all files in the vault's storage folder
        const { data: files, error: listError } = await supabase.storage
          .from("vault_files")
          .list(vault.uid);

        if (listError) {
          errors.push(
            `Failed to list files for vault ${vault.uid}: ${listError.message}`
          );
          continue;
        }

        // Delete all files in the vault folder
        if (files && files.length > 0) {
          const filePaths = files.map((f) => `${vault.uid}/${f.name}`);
          const { error: deleteError } = await supabase.storage
            .from("vault_files")
            .remove(filePaths);

          if (deleteError) {
            errors.push(
              `Failed to delete files for vault ${vault.uid}: ${deleteError.message}`
            );
            continue;
          }
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
