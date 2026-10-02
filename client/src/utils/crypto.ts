/**
 * @module utils/crypto
 * @description Cryptographic primitives — libsodium initialization, Argon2id
 * key derivation, authenticated encryption, hashing, UID and session token
 * generation, and secure memory wiping.
 */
import _sodium from "libsodium-wrappers-sumo";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { cryptoLogger } from "./logger";

// Singleton initialization pattern for libsodium WASM
let sodiumReady: Promise<typeof _sodium> | null = null;

export async function getSodium(): Promise<typeof _sodium> {
  if (!sodiumReady) {
    sodiumReady = _sodium.ready.then(() => _sodium);
  }
  return sodiumReady;
}

// Argon2id parameters (OWASP Spec)
const ARGON2_MEMORY_KB = 25 * 1000; // 25 MB (OWASP min: 19MB)
const ARGON2_ITERATIONS = 2; // OWASP min: 2
const FIXED_SALT = "trove-v1-salt-2026";
const KEY_LENGTH = 32;

// Context strings for key derivation (must be exactly 8 bytes)
const CONTEXT_ENCRYPTION_KEY = "trove_ek";
const CONTEXT_VAULT_ID = "trove_id";
const CONTEXT_AUTH_KEY = "trove_au";

/**
 * Derive master secret from seed phrase using Argon2id
 * Light parameters for ~100ms derivation time
 */
export async function deriveMasterSecret(
  seedPhrase: string
): Promise<Uint8Array> {
  const sodium = await getSodium();

  // Convert seed phrase to bytes (UTF-8)
  const password = sodium.from_string(seedPhrase);

  // Create salt of required length (16 bytes for Argon2id)
  const saltBytes = sodium.from_string(FIXED_SALT);
  const paddedSalt = new Uint8Array(sodium.crypto_pwhash_SALTBYTES);
  paddedSalt.set(
    saltBytes.slice(
      0,
      Math.min(saltBytes.length, sodium.crypto_pwhash_SALTBYTES)
    )
  );

  const masterSecret = sodium.crypto_pwhash(
    KEY_LENGTH,
    password,
    paddedSalt,
    ARGON2_ITERATIONS,
    ARGON2_MEMORY_KB * 1000, // Convert KB to bytes
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  return masterSecret;
}

/**
 * Derive encryption key from master secret using crypto_kdf (Blake2b-based)
 */
export async function deriveEncryptionKey(
  masterSecret: Uint8Array
): Promise<Uint8Array> {
  const sodium = await getSodium();

  return sodium.crypto_kdf_derive_from_key(
    KEY_LENGTH,
    1, // subkey_id for encryption key
    CONTEXT_ENCRYPTION_KEY,
    masterSecret
  );
}

/**
 * Derive vault UID from master secret
 * Returns hex string for use as database identifier
 */
export async function deriveVaultUid(
  masterSecret: Uint8Array
): Promise<string> {
  const sodium = await getSodium();

  const derivedKey = sodium.crypto_kdf_derive_from_key(
    KEY_LENGTH,
    2, // subkey_id for vault ID
    CONTEXT_VAULT_ID,
    masterSecret
  );

  // Hash the derived key with SHA3-256 for algorithm diversity (defense-in-depth)
  const hash = sha3_256(derivedKey);

  // Clean up intermediate key
  sodium.memzero(derivedKey);

  return sodium.to_hex(hash);
}

/**
 * Derive the vault auth key from master secret
 * Proves seed phrase possession when creating a session. Returned as hex;
 * the server stores only its SHA-256.
 */
export async function deriveAuthKey(masterSecret: Uint8Array): Promise<string> {
  const sodium = await getSodium();

  const authKey = sodium.crypto_kdf_derive_from_key(
    KEY_LENGTH,
    3, // subkey_id for auth key
    CONTEXT_AUTH_KEY,
    masterSecret
  );

  const hex = sodium.to_hex(authKey);
  sodium.memzero(authKey);
  return hex;
}

/**
 * Hash the auth key (hex) with SHA-256 for storage on the vault record
 */
export async function hashAuthKey(authKey: string): Promise<string> {
  const sodium = await getSodium();
  return sodium.to_hex(sha256(sodium.from_hex(authKey)));
}

/**
 * Derive all keys from seed phrase in one call
 * Returns encryption key, vault UID, and auth key; securely wipes master secret
 */
export async function deriveKeys(seedPhrase: string): Promise<{
  encryptionKey: Uint8Array;
  vaultUid: string;
  authKey: string;
}> {
  const masterSecret = await deriveMasterSecret(seedPhrase);
  const encryptionKey = await deriveEncryptionKey(masterSecret);
  const vaultUid = await deriveVaultUid(masterSecret);
  const authKey = await deriveAuthKey(masterSecret);

  cryptoLogger.log("deriveKeys:", {
    wordCount: seedPhrase.trim().split(/\s+/).length,
    vaultUid: vaultUid.slice(0, 16) + "...",
  });

  // Wipe master secret immediately after use
  await secureWipe(masterSecret);

  return { encryptionKey, vaultUid, authKey };
}

/**
 * Encrypt data with XChaCha20-Poly1305
 * Returns: [nonce (24 bytes)][ciphertext + auth tag (16 bytes)]
 * `aad` is authenticated but not stored; the decryptor must supply the same.
 */
export async function encrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array | null = null
): Promise<Uint8Array> {
  const sodium = await getSodium();

  // Generate random 24-byte nonce (safe for random generation with XChaCha20)
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );

  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null, // secret nonce (not used)
    nonce,
    key
  );

  // Prepend nonce to ciphertext
  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.length);

  return result;
}

/**
 * Decrypt data with XChaCha20-Poly1305
 * Input format: [nonce (24 bytes)][ciphertext + auth tag]
 */
export async function decrypt(
  ciphertextWithNonce: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array | null = null
): Promise<Uint8Array> {
  const sodium = await getSodium();

  const nonceLength = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  const minLength =
    nonceLength + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;

  if (ciphertextWithNonce.length < minLength) {
    throw new Error("Invalid ciphertext: too short");
  }

  const nonce = ciphertextWithNonce.slice(0, nonceLength);
  const ciphertext = ciphertextWithNonce.slice(nonceLength);

  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, // secret nonce (not used)
      ciphertext,
      aad,
      nonce,
      key
    );
  } catch {
    throw new Error("Decryption failed: invalid key or corrupted data");
  }
}

/**
 * Encrypt a string to bytes
 */
export async function encryptString(
  plaintext: string,
  key: Uint8Array
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const plaintextBytes = sodium.from_string(plaintext);
  return encrypt(plaintextBytes, key);
}

/**
 * Decrypt bytes to string
 */
export async function decryptToString(
  ciphertext: Uint8Array,
  key: Uint8Array
): Promise<string> {
  const sodium = await getSodium();
  const plaintextBytes = await decrypt(ciphertext, key);
  return sodium.to_string(plaintextBytes);
}

/**
 * Derive deterministic chunk UID from file UID, manifest key, and chunk index
 * chunk_uid = BLAKE2b(file_uid || ":" || manifest_key || ":" || chunk_index)
 */
export async function deriveChunkUid(
  fileUid: string,
  manifestKey: string,
  chunkIndex: number
): Promise<string> {
  const sodium = await getSodium();

  const input = sodium.from_string(`${fileUid}:${manifestKey}:${chunkIndex}`);
  const hash = sodium.crypto_generichash(32, input);

  return sodium.to_hex(hash);
}

/**
 * Generate a random UUID for file identification
 */
export function generateFileUid(): string {
  return crypto.randomUUID();
}

/**
 * Generate random bytes
 */
export async function randomBytes(length: number): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(length);
}

/**
 * Securely clear sensitive data from memory
 * Note: JavaScript doesn't guarantee memory clearing, but this is best effort
 */
export async function secureWipe(data: Uint8Array): Promise<void> {
  const sodium = await getSodium();
  sodium.memzero(data);
}

/**
 * Convert Uint8Array to hex string
 */
export async function toHex(data: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  return sodium.to_hex(data);
}

/**
 * Convert hex string to Uint8Array
 */
export async function fromHex(hex: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.from_hex(hex);
}

/**
 * Generate a random session token (32 bytes, returned as hex)
 * Used for vault session authentication
 */
export async function generateSessionToken(): Promise<string> {
  const sodium = await getSodium();
  const tokenBytes = sodium.randombytes_buf(32);
  return sodium.to_hex(tokenBytes);
}

/**
 * Hash a session token using SHA-256 for storage
 * The hash is stored server-side, the raw token stays client-side
 */
export async function hashSessionToken(token: string): Promise<string> {
  const sodium = await getSodium();
  const tokenBytes = sodium.from_hex(token);
  const hash = sha256(tokenBytes);
  return sodium.to_hex(hash);
}

const EDIT_PASSWORD_SALT_PREFIX = "trove-edit-v1:";

/**
 * Pre-hash the edit password with Argon2id before sending it to the server.
 * Salted with the vault UID so the same password differs across vaults.
 * The server bcrypts this value; it never sees the raw password.
 */
export async function deriveEditPasswordHash(
  password: string,
  vaultUid: string
): Promise<string> {
  const sodium = await getSodium();

  const passwordBytes = sodium.from_string(password);
  const salt = sha256(
    sodium.from_string(EDIT_PASSWORD_SALT_PREFIX + vaultUid)
  ).slice(0, sodium.crypto_pwhash_SALTBYTES);

  const hash = sodium.crypto_pwhash(
    KEY_LENGTH,
    passwordBytes,
    salt,
    ARGON2_ITERATIONS,
    ARGON2_MEMORY_KB * 1000,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  sodium.memzero(passwordBytes);
  return sodium.to_hex(hash);
}
