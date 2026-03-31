import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createVaultClient,
  clearVaultClient,
  supabaseBase,
  TABLES,
  SESSION_TOKEN_TTL_MS,
} from "../utils/supabase";
import {
  deriveKeys,
  encrypt,
  decrypt,
  secureWipe,
  generateFileUid,
  generateSessionToken,
  hashSessionToken,
} from "../utils/crypto";
import { vaultLogger } from "../utils/logger";
import {
  type VaultManifest,
  type BurnTimerOption,
  FREE_STORAGE_BYTES,
} from "../types/types";

// Helper to convert hex string (from Supabase BYTEA) to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  // Remove \x prefix if present
  const cleanHex = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Helper to convert Uint8Array to hex string for Supabase BYTEA
function bytesToHex(bytes: Uint8Array): string {
  return (
    "\\x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

// State shape
interface VaultState {
  isUnlocked: boolean;
  isLoading: boolean;
  error: string | null;
  vaultUid: string | null;
  manifest: VaultManifest;
  storageUsed: number;
  storageLimit: number;
  burnAt: string | null;
}

// Actions
type VaultAction =
  | { type: "UNLOCK_START" }
  | {
      type: "UNLOCK_SUCCESS";
      payload: {
        vaultUid: string;
        manifest: VaultManifest;
        storageUsed: number;
        storageLimit: number;
        burnAt: string | null;
      };
    }
  | { type: "UNLOCK_ERROR"; payload: string }
  | { type: "UPDATE_MANIFEST"; payload: VaultManifest }
  | { type: "UPDATE_STORAGE"; payload: number }
  | { type: "CLEAR_ERROR" }
  | { type: "LOGOUT" };

const initialState: VaultState = {
  isUnlocked: false,
  isLoading: false,
  error: null,
  vaultUid: null,
  manifest: { manifest_key: "", entries: [] },
  storageUsed: 0,
  storageLimit: 5368709120, // 5GB
  burnAt: null,
};

function vaultReducer(state: VaultState, action: VaultAction): VaultState {
  switch (action.type) {
    case "UNLOCK_START":
      return { ...state, isLoading: true, error: null };
    case "UNLOCK_SUCCESS":
      return {
        ...state,
        isLoading: false,
        isUnlocked: true,
        vaultUid: action.payload.vaultUid,
        manifest: action.payload.manifest,
        storageUsed: action.payload.storageUsed,
        storageLimit: action.payload.storageLimit,
        burnAt: action.payload.burnAt,
      };
    case "UNLOCK_ERROR":
      return { ...state, isLoading: false, error: action.payload };
    case "UPDATE_MANIFEST":
      return { ...state, manifest: action.payload };
    case "UPDATE_STORAGE":
      return { ...state, storageUsed: action.payload };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "LOGOUT":
      return initialState;
    default:
      return state;
  }
}

// Context value type
interface VaultContextValue extends VaultState {
  unlockVault: (seedPhrase: string) => Promise<boolean>;
  createVault: (
    seedPhrase: string,
    burnTimer: BurnTimerOption
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  updateManifest: (
    manifestOrUpdater:
      | VaultManifest
      | ((current: VaultManifest) => VaultManifest)
  ) => Promise<void>;
  updateStorageUsed: (delta: number) => Promise<void>;
  clearError: () => void;
  getClient: () => SupabaseClient | null;
  getEncryptionKey: () => Uint8Array | null;
  getManifestKey: () => string | null;
}

const VaultContext = createContext<VaultContextValue | null>(null);

// Calculate burn_at timestamp from option
function calculateBurnAt(timer: BurnTimerOption): string | null {
  if (timer === "never") return null;

  const now = new Date();
  switch (timer) {
    case "24h":
      now.setHours(now.getHours() + 24);
      break;
    case "7d":
      now.setDate(now.getDate() + 7);
      break;
    case "30d":
      now.setDate(now.getDate() + 30);
      break;
    case "90d":
      now.setDate(now.getDate() + 90);
      break;
    case "1y":
      now.setFullYear(now.getFullYear() + 1);
      break;
  }
  return now.toISOString();
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(vaultReducer, initialState);

  // Store sensitive data in refs (not in React state)
  // These are closure variables, providing slight memory protection
  const encryptionKeyRef = useRef<Uint8Array | null>(null);
  const vaultClientRef = useRef<SupabaseClient | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const sessionRefreshIntervalRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);

  // Manifest ref for atomic updates (avoids race conditions)
  const manifestRef = useRef<VaultManifest>(state.manifest);
  manifestRef.current = state.manifest;
  const manifestUpdateLockRef = useRef<Promise<void>>(Promise.resolve());

  // Storage ref for atomic updates (avoids race condition when multiple files upload simultaneously)
  const storageUsedRef = useRef(state.storageUsed);

  // Sync storage ref when vault is unlocked (external state change)
  useEffect(() => {
    storageUsedRef.current = state.storageUsed;
  }, [state.vaultUid]); // Only sync when vault changes, not on every storage update

  const getEncryptionKey = useCallback(() => encryptionKeyRef.current, []);
  const getClient = useCallback(() => vaultClientRef.current, []);
  const getManifestKey = useCallback(
    () => (state.isUnlocked ? state.manifest.manifest_key : null),
    [state.isUnlocked, state.manifest.manifest_key]
  );

  /**
   * Create a new session token and store it server-side
   * Returns the raw token for client use
   */
  const createSession = useCallback(
    async (vaultUid: string, client: SupabaseClient): Promise<string> => {
      // Generate random token
      const token = await generateSessionToken();
      const tokenHash = await hashSessionToken(token);

      // Calculate expiry (1 hour from now)
      const expiresAt = new Date(
        Date.now() + SESSION_TOKEN_TTL_MS
      ).toISOString();

      // Store hash in database
      const { error } = await client.from(TABLES.VAULT_SESSIONS).insert({
        vault_uid: vaultUid,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });

      if (error) {
        vaultLogger.error("Failed to create session:", {
          code: error.code,
          message: error.message,
        });
        throw new Error("Failed to create session");
      }

      vaultLogger.log("Session created, expires:", expiresAt);
      return token;
    },
    []
  );

  /**
   * Refresh session by creating a new token and deleting the old one
   */
  const refreshSession = useCallback(async (): Promise<void> => {
    const vaultUid = state.vaultUid;
    const oldToken = sessionTokenRef.current;

    if (!vaultUid || !oldToken) {
      return;
    }

    try {
      // Create a temporary client with the old token for the delete operation
      const tempClient = createVaultClient(vaultUid, oldToken);

      // Generate new token
      const newToken = await generateSessionToken();
      const newTokenHash = await hashSessionToken(newToken);
      const expiresAt = new Date(
        Date.now() + SESSION_TOKEN_TTL_MS
      ).toISOString();

      // Insert new session
      const { error: insertError } = await tempClient
        .from(TABLES.VAULT_SESSIONS)
        .insert({
          vault_uid: vaultUid,
          token_hash: newTokenHash,
          expires_at: expiresAt,
        });

      if (insertError) {
        vaultLogger.error("Failed to refresh session:", insertError);
        return;
      }

      // Delete old session
      const oldTokenHash = await hashSessionToken(oldToken);
      await tempClient
        .from(TABLES.VAULT_SESSIONS)
        .delete()
        .eq("token_hash", oldTokenHash);

      // Update refs with new token and client
      sessionTokenRef.current = newToken;
      vaultClientRef.current = createVaultClient(vaultUid, newToken);

      vaultLogger.log("Session refreshed, new expiry:", expiresAt);
    } catch (err) {
      vaultLogger.error("Session refresh error:", err);
    }
  }, [state.vaultUid]);

  /**
   * Delete the current session from server
   */
  const deleteSession = useCallback(async (): Promise<void> => {
    const token = sessionTokenRef.current;
    const vaultUid = state.vaultUid;

    if (!token || !vaultUid) {
      return;
    }

    try {
      const tokenHash = await hashSessionToken(token);
      const client = createVaultClient(vaultUid, token);

      await client
        .from(TABLES.VAULT_SESSIONS)
        .delete()
        .eq("token_hash", tokenHash);

      vaultLogger.log("Session deleted");
    } catch (err) {
      vaultLogger.error("Failed to delete session:", err);
    }

    sessionTokenRef.current = null;
  }, [state.vaultUid]);

  /**
   * Start periodic session refresh (every 30 minutes for 1 hour TTL)
   */
  const startSessionRefresh = useCallback(() => {
    // Clear any existing interval
    if (sessionRefreshIntervalRef.current) {
      clearInterval(sessionRefreshIntervalRef.current);
    }

    // Refresh at half the TTL to ensure we never expire
    const refreshInterval = SESSION_TOKEN_TTL_MS / 2;
    sessionRefreshIntervalRef.current = setInterval(() => {
      refreshSession();
    }, refreshInterval);

    vaultLogger.log(
      "Session refresh scheduled every",
      refreshInterval / 60000,
      "minutes"
    );
  }, [refreshSession]);

  /**
   * Stop periodic session refresh
   */
  const stopSessionRefresh = useCallback(() => {
    if (sessionRefreshIntervalRef.current) {
      clearInterval(sessionRefreshIntervalRef.current);
      sessionRefreshIntervalRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  const logout = useCallback(async () => {
    vaultLogger.log("Logging out...");

    // Stop session refresh
    stopSessionRefresh();

    // Delete session from server
    await deleteSession();

    // Clear cached Supabase client
    if (state.vaultUid) {
      clearVaultClient(state.vaultUid);
    }
    // Securely wipe encryption key
    if (encryptionKeyRef.current) {
      await secureWipe(encryptionKeyRef.current);
      encryptionKeyRef.current = null;
    }
    vaultClientRef.current = null;
    sessionTokenRef.current = null;
    dispatch({ type: "LOGOUT" });
    vaultLogger.log("Logged out, keys wiped, session deleted");
  }, [state.vaultUid, stopSessionRefresh, deleteSession]);

  const createVault = useCallback(
    async (
      seedPhrase: string,
      burnTimer: BurnTimerOption
    ): Promise<boolean> => {
      dispatch({ type: "UNLOCK_START" });

      try {
        // Derive keys from seed phrase
        const { encryptionKey, vaultUid } = await deriveKeys(seedPhrase);

        // Calculate burn_at timestamp
        const burnAt = calculateBurnAt(burnTimer);

        // Encrypt empty manifest with fresh manifest_key
        const emptyManifest: VaultManifest = {
          manifest_key: generateFileUid(),
          entries: [],
        };
        const manifestJson = JSON.stringify(emptyManifest);
        const manifestBytes = new TextEncoder().encode(manifestJson);
        const manifestCipher = await encrypt(manifestBytes, encryptionKey);

        // Create vault record (using base client, no header needed for insert)
        const { error } = await supabaseBase.from(TABLES.VAULTS).insert({
          uid: vaultUid,
          manifest_cipher: bytesToHex(manifestCipher),
          burn_at: burnAt,
          storage_limit: FREE_STORAGE_BYTES,
        });

        if (error) {
          vaultLogger.error("Creation failed:", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
          if (error.code === "23505") {
            throw new Error("A vault with this seed phrase already exists");
          }
          throw error;
        }

        vaultLogger.log("Created successfully:", {
          vaultUid: vaultUid.slice(0, 16) + "...",
          burnAt,
          storageLimit: FREE_STORAGE_BYTES,
        });

        // Create free storage transaction
        const { error: transactError } = await supabaseBase
          .from(TABLES.STORAGE_TRANSACTS)
          .insert({
            transaction_uid: `free-${vaultUid.slice(0, 16)}`,
            vault_uid: vaultUid,
            storage_bytes: FREE_STORAGE_BYTES,
            previous_transact: null,
          });

        if (transactError) {
          vaultLogger.error("Storage transaction failed:", {
            code: transactError.code,
            message: transactError.message,
            details: transactError.details,
            hint: transactError.hint,
          });
        } else {
          vaultLogger.log(
            "Free storage transaction created:",
            FREE_STORAGE_BYTES,
            "bytes"
          );
        }

        // Create initial client (without token) for session creation
        const initialClient = createVaultClient(vaultUid);

        // Create session token for storage access
        const sessionToken = await createSession(vaultUid, initialClient);

        // Store keys and create final client with token
        encryptionKeyRef.current = encryptionKey;
        sessionTokenRef.current = sessionToken;
        vaultClientRef.current = createVaultClient(vaultUid, sessionToken);

        // Start session refresh timer
        startSessionRefresh();

        dispatch({
          type: "UNLOCK_SUCCESS",
          payload: {
            vaultUid,
            manifest: emptyManifest,
            storageUsed: 0,
            storageLimit: FREE_STORAGE_BYTES,
            burnAt,
          },
        });

        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create vault";
        dispatch({ type: "UNLOCK_ERROR", payload: message });
        return false;
      }
    },
    [createSession, startSessionRefresh]
  );

  const unlockVault = useCallback(
    async (seedPhrase: string): Promise<boolean> => {
      dispatch({ type: "UNLOCK_START" });

      try {
        // Derive keys from seed phrase
        const { encryptionKey, vaultUid } = await deriveKeys(seedPhrase);

        // Create client with vault header
        const client = createVaultClient(vaultUid);

        // Fetch vault record
        const { data, error } = await client
          .from(TABLES.VAULTS)
          .select("*")
          .eq("uid", vaultUid)
          .single();

        if (error || !data) {
          vaultLogger.error(
            "Fetch failed:",
            error
              ? {
                  code: error.code,
                  message: error.message,
                  details: error.details,
                  hint: error.hint,
                }
              : "No data returned"
          );
          await secureWipe(encryptionKey);
          throw new Error("Unable to access vault");
        }

        vaultLogger.log("Fetched:", {
          vaultUid: vaultUid.slice(0, 16) + "...",
          storageUsed: data.storage_used,
          storageLimit: data.storage_limit,
          burnAt: data.burn_at,
        });

        // Decrypt manifest - Supabase returns BYTEA as hex string
        const manifestCipherArray = hexToBytes(data.manifest_cipher);
        let manifest: VaultManifest;

        try {
          const manifestBytes = await decrypt(
            manifestCipherArray,
            encryptionKey
          );
          const manifestJson = new TextDecoder().decode(manifestBytes);
          manifest = JSON.parse(manifestJson);
        } catch (decryptError) {
          vaultLogger.error("Decryption failed:", decryptError);
          await secureWipe(encryptionKey);
          throw new Error("Unable to access vault");
        }

        vaultLogger.log("Manifest decrypted:", {
          entries: manifest.entries.length,
          files: manifest.entries.filter((e) => e.type === "file").length,
          folders: manifest.entries.filter((e) => e.type === "folder").length,
          manifest,
        });

        // Sum all storage transactions to calculate current limit
        const { data: transacts, error: transactsError } = await client
          .from(TABLES.STORAGE_TRANSACTS)
          .select("storage_bytes")
          .eq("vault_uid", vaultUid);

        if (transactsError) {
          vaultLogger.error("Storage transactions fetch failed:", {
            code: transactsError.code,
            message: transactsError.message,
            details: transactsError.details,
            hint: transactsError.hint,
          });
        }

        const storageLimit = transacts
          ? transacts.reduce((sum, t) => sum + (t.storage_bytes || 0), 0)
          : data.storage_limit;

        vaultLogger.log("Storage transactions:", {
          count: transacts?.length || 0,
          totalBytes: storageLimit,
        });

        // Update storage_limit in vault if it changed
        if (storageLimit !== data.storage_limit) {
          const { error: updateError } = await client
            .from(TABLES.VAULTS)
            .update({ storage_limit: storageLimit })
            .eq("uid", vaultUid);

          if (updateError) {
            vaultLogger.error("Storage limit update failed:", {
              code: updateError.code,
              message: updateError.message,
              details: updateError.details,
              hint: updateError.hint,
            });
          }
        }

        // Create session token for storage access
        const sessionToken = await createSession(vaultUid, client);

        // Store keys and create final client with token
        encryptionKeyRef.current = encryptionKey;
        sessionTokenRef.current = sessionToken;
        vaultClientRef.current = createVaultClient(vaultUid, sessionToken);

        // Start session refresh timer
        startSessionRefresh();

        dispatch({
          type: "UNLOCK_SUCCESS",
          payload: {
            vaultUid,
            manifest,
            storageUsed: data.storage_used,
            storageLimit,
            burnAt: data.burn_at,
          },
        });

        vaultLogger.log("Unlocked successfully");

        return true;
      } catch (err) {
        vaultLogger.error("Unlock error:", err);
        dispatch({ type: "UNLOCK_ERROR", payload: "Unable to access vault" });
        return false;
      }
    },
    [createSession, startSessionRefresh]
  );

  const updateManifest = useCallback(
    async (
      manifestOrUpdater:
        | VaultManifest
        | ((current: VaultManifest) => VaultManifest)
    ): Promise<void> => {
      // Chain onto existing updates to serialize them
      const previousUpdate = manifestUpdateLockRef.current;
      let resolve: () => void;
      manifestUpdateLockRef.current = new Promise<void>((r) => {
        resolve = r;
      });

      try {
        // Wait for any previous update to complete
        await previousUpdate;

        const encryptionKey = encryptionKeyRef.current;
        const client = vaultClientRef.current;

        if (!encryptionKey || !client || !state.vaultUid) {
          throw new Error("Vault not unlocked");
        }

        // Get the manifest to save - either directly or via updater function
        const manifest =
          typeof manifestOrUpdater === "function"
            ? manifestOrUpdater(manifestRef.current)
            : manifestOrUpdater;

        // Encrypt new manifest
        const manifestJson = JSON.stringify(manifest);
        const manifestBytes = new TextEncoder().encode(manifestJson);
        const manifestCipher = await encrypt(manifestBytes, encryptionKey);

        // Update on server
        const { error } = await client
          .from(TABLES.VAULTS)
          .update({ manifest_cipher: bytesToHex(manifestCipher) })
          .eq("uid", state.vaultUid);

        if (error) {
          vaultLogger.error("Manifest update failed:", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
          throw error;
        }

        vaultLogger.log("Manifest updated:", {
          entries: manifest.entries.length,
          files: manifest.entries.filter((e) => e.type === "file").length,
          folders: manifest.entries.filter((e) => e.type === "folder").length,
          manifest,
        });

        // Update ref immediately so next queued update sees it
        manifestRef.current = manifest;
        dispatch({ type: "UPDATE_MANIFEST", payload: manifest });
      } finally {
        resolve!();
      }
    },
    [state.vaultUid]
  );

  const updateStorageUsed = useCallback(
    async (delta: number) => {
      // Update ref synchronously to avoid race conditions when multiple files upload
      storageUsedRef.current += delta;
      const newStorageUsed = storageUsedRef.current;

      dispatch({ type: "UPDATE_STORAGE", payload: newStorageUsed });

      // Persist to Supabase
      const client = vaultClientRef.current;
      if (client && state.vaultUid) {
        const { error } = await client
          .from(TABLES.VAULTS)
          .update({ storage_used: newStorageUsed })
          .eq("uid", state.vaultUid);

        if (error) {
          vaultLogger.error("Failed to update storage_used in database:", {
            code: error.code,
            message: error.message,
          });
        }
      }
    },
    [state.vaultUid]
  );

  const value: VaultContextValue = {
    ...state,
    unlockVault,
    createVault,
    logout,
    updateManifest,
    updateStorageUsed,
    clearError,
    getClient,
    getEncryptionKey,
    getManifestKey,
  };

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}

export function useVault() {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within VaultProvider");
  }
  return context;
}
