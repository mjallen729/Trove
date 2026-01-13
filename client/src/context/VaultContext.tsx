import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createVaultClient,
  clearVaultClient,
  supabaseBase,
  TABLES,
} from "../utils/supabase";
import { deriveKeys, encrypt, decrypt, secureWipe } from "../utils/crypto";
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
  manifest: [],
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
    manifestOrUpdater: VaultManifest | ((current: VaultManifest) => VaultManifest)
  ) => Promise<void>;
  updateStorageUsed: (delta: number) => Promise<void>;
  clearError: () => void;
  getClient: () => SupabaseClient | null;
  getEncryptionKey: () => Uint8Array | null;
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

  // Manifest ref for atomic updates (avoids race conditions)
  const manifestRef = useRef<VaultManifest>(state.manifest);
  manifestRef.current = state.manifest;
  const manifestUpdateLockRef = useRef<Promise<void>>(Promise.resolve());

  const getEncryptionKey = useCallback(() => encryptionKeyRef.current, []);
  const getClient = useCallback(() => vaultClientRef.current, []);

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  const logout = useCallback(async () => {
    vaultLogger.log("Logging out...");
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
    dispatch({ type: "LOGOUT" });
    vaultLogger.log("Logged out, keys wiped");
  }, [state.vaultUid]);

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

        // Encrypt empty manifest
        const emptyManifest: VaultManifest = [];
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
          vaultLogger.log("Free storage transaction created:", FREE_STORAGE_BYTES, "bytes");
        }

        // Store keys in refs
        encryptionKeyRef.current = encryptionKey;
        vaultClientRef.current = createVaultClient(vaultUid);

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
    []
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
          vaultLogger.error("Fetch failed:", error ? {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          } : "No data returned");
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
          const manifestBytes = await decrypt(manifestCipherArray, encryptionKey);
          const manifestJson = new TextDecoder().decode(manifestBytes);
          manifest = JSON.parse(manifestJson);
        } catch (decryptError) {
          vaultLogger.error("Decryption failed:", decryptError);
          await secureWipe(encryptionKey);
          throw new Error("Unable to access vault");
        }

        vaultLogger.log("Manifest decrypted:", {
          entries: manifest.length,
          files: manifest.filter((e) => e.type === "file").length,
          folders: manifest.filter((e) => e.type === "folder").length,
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

        // Store keys in refs
        encryptionKeyRef.current = encryptionKey;
        vaultClientRef.current = client;

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
    []
  );

  const updateManifest = useCallback(
    async (
      manifestOrUpdater: VaultManifest | ((current: VaultManifest) => VaultManifest)
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
          entries: manifest.length,
          files: manifest.filter((e) => e.type === "file").length,
          folders: manifest.filter((e) => e.type === "folder").length,
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
      const newStorageUsed = state.storageUsed + delta;
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
    [state.storageUsed, state.vaultUid]
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
