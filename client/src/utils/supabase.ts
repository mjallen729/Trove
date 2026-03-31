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
 * @param sessionToken Optional session token for storage access (raw token, not hash)
 */
export function createVaultClient(
  vaultUid: string,
  sessionToken?: string
): SupabaseClient {
  // Cache key includes token presence to allow updating client with token
  const cacheKey = sessionToken ? `${vaultUid}:${sessionToken}` : vaultUid;
  const cached = vaultClientCache.get(cacheKey);
  if (cached) return cached;

  const headers: Record<string, string> = {
    "x-vault-uid": vaultUid,
  };

  // Add session token header if provided (required for storage operations)
  if (sessionToken) {
    headers["x-vault-token"] = sessionToken;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `trove-vault-${vaultUid.slice(0, 8)}`, // Unique key per vault
    },
    global: {
      headers,
    },
  });

  vaultClientCache.set(cacheKey, client);
  return client;
}

/**
 * Clear cached vault client (call on logout)
 */
export function clearVaultClient(vaultUid: string): void {
  vaultClientCache.delete(vaultUid);
}

/**
 * Create a temporary Supabase client with invite code header for vault creation
 * Temporary: remove when invite code gate is removed
 */
export function createInviteClient(inviteCode: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "trove-invite",
    },
    global: {
      headers: { "x-invite-code": inviteCode },
    },
  });
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
  VAULT_SESSIONS: "vault_sessions",
} as const;

/**
 * Session token TTL in milliseconds (1 hour)
 */
export const SESSION_TOKEN_TTL_MS = 60 * 60 * 1000;
