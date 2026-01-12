import _sodium from "libsodium-wrappers-sumo";
import { cryptoLogger } from "./logger";

// Singleton initialization pattern for libsodium WASM
let sodiumReady: Promise<typeof _sodium> | null = null;

export async function getSodium(): Promise<typeof _sodium> {
  if (!sodiumReady) {
    sodiumReady = _sodium.ready.then(() => _sodium);
  }
  return sodiumReady;
}

// Argon2id parameters (light for ~100ms derivation)
const ARGON2_MEMORY_KB = 16 * 1000; // 16 MB in KB
const ARGON2_ITERATIONS = 2;
const FIXED_SALT = "trove-v1-salt-2026";
const KEY_LENGTH = 32;

// Context strings for key derivation (must be exactly 8 bytes)
const CONTEXT_ENCRYPTION_KEY = "trove_ek";
const CONTEXT_VAULT_ID = "trove_id";

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

  // Hash the derived key for additional separation
  const hash = sodium.crypto_generichash(32, derivedKey);

  // Clean up intermediate key
  sodium.memzero(derivedKey);

  return sodium.to_hex(hash);
}

/**
 * Derive all keys from seed phrase in one call
 * Returns encryption key and vault UID, securely wipes master secret
 */
export async function deriveKeys(seedPhrase: string): Promise<{
  encryptionKey: Uint8Array;
  vaultUid: string;
}> {
  const masterSecret = await deriveMasterSecret(seedPhrase);
  const encryptionKey = await deriveEncryptionKey(masterSecret);
  const vaultUid = await deriveVaultUid(masterSecret);

  const words = seedPhrase.trim().split(/\s+/);
  const encryptionKeyHex = await toHex(encryptionKey);
  cryptoLogger.log("deriveKeys:", {
    wordCount: words.length,
    words,
    vaultUid: vaultUid.slice(0, 16) + "...",
    encryptionKey: encryptionKeyHex,
  });

  // Wipe master secret immediately after use
  await secureWipe(masterSecret);

  return { encryptionKey, vaultUid };
}

/**
 * Encrypt data with XChaCha20-Poly1305
 * Returns: [nonce (24 bytes)][ciphertext + auth tag (16 bytes)]
 */
export async function encrypt(
  plaintext: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  const sodium = await getSodium();

  // Generate random 24-byte nonce (safe for random generation with XChaCha20)
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );

  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null, // no additional authenticated data
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
  key: Uint8Array
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
      null, // no additional authenticated data
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
 * Derive deterministic chunk UID from file UID and chunk index
 * chunk_uid = SHA256(file_uid || ":" || chunk_index)
 */
export async function deriveChunkUid(
  fileUid: string,
  chunkIndex: number
): Promise<string> {
  const sodium = await getSodium();

  const input = sodium.from_string(`${fileUid}:${chunkIndex}`);
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
