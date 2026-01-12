import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required"
  );
}

// Supabase client options - disable GoTrue auth since we use seed phrase auth
const baseClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "trove-base", // Unique key to prevent "Multiple GoTrueClient" warning
  },
};

/**
 * Base Supabase client without vault context
 * Use for vault creation (INSERT doesn't need header) and public operations
 */
export const supabaseBase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  baseClientOptions
);

// Cache for vault-specific clients
const vaultClientCache = new Map<string, SupabaseClient>();

/**
 * Create a Supabase client with vault UID header for RLS
 * This must be called after vault unlock to get proper row-level access
 * Clients are cached by vaultUid to avoid multiple GoTrueClient instances
 *
 * @param vaultUid The derived vault UID (hash of master secret derivation)
 */
export function createVaultClient(vaultUid: string): SupabaseClient {
  const cached = vaultClientCache.get(vaultUid);
  if (cached) return cached;

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `trove-vault-${vaultUid.slice(0, 8)}`, // Unique key per vault
    },
    global: {
      headers: {
        "x-vault-uid": vaultUid,
      },
    },
  });

  vaultClientCache.set(vaultUid, client);
  return client;
}

/**
 * Clear cached vault client (call on logout)
 */
export function clearVaultClient(vaultUid: string): void {
  vaultClientCache.delete(vaultUid);
}

/**
 * Storage bucket name for encrypted file chunks
 * Path structure: {vault_uid}/{chunk_uid}
 */
export const STORAGE_BUCKET = "vault_files";

/**
 * Database table names
 */
export const TABLES = {
  VAULTS: "vaults",
  UPLOADS: "uploads",
  STORAGE_TRANSACTS: "storage_transacts",
} as const;
