/**
 * @module utils/chunks
 * @description File chunking utilities — reading, encrypting, and decrypting
 * chunks, storage path derivation, and handing a Blob to the browser.
 */
import { CHUNK_SIZE } from "../types/types";
import { encrypt, decrypt, deriveChunkUid } from "./crypto";

export { CHUNK_SIZE };

/**
 * Calculate number of chunks needed for a file
 */
export function calculateChunkCount(fileSize: number): number {
  return Math.ceil(fileSize / CHUNK_SIZE);
}

/**
 * Read a specific chunk from a File object
 */
export async function readChunk(
  file: File,
  chunkIndex: number
): Promise<Uint8Array> {
  const start = chunkIndex * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, file.size);
  const blob = file.slice(start, end);
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Associated data binding a chunk to its file and position (enc_v 2).
 * chunk_count is already authenticated inside the encrypted manifest.
 */
export function chunkAad(fileUid: string, chunkIndex: number): Uint8Array {
  return new TextEncoder().encode(`${fileUid}:${chunkIndex}`);
}

/**
 * Encrypt a chunk with unique nonce
 */
export async function encryptChunk(
  chunk: Uint8Array,
  encryptionKey: Uint8Array,
  aad: Uint8Array | null
): Promise<Uint8Array> {
  return encrypt(chunk, encryptionKey, aad);
}

/**
 * Decrypt a chunk
 */
export async function decryptChunk(
  encryptedChunk: Uint8Array,
  encryptionKey: Uint8Array,
  aad: Uint8Array | null
): Promise<Uint8Array> {
  return decrypt(encryptedChunk, encryptionKey, aad);
}

/**
 * Get storage path for a chunk
 */
export async function getChunkPath(
  vaultUid: string,
  fileUid: string,
  manifestKey: string,
  chunkIndex: number
): Promise<string> {
  const chunkUid = await deriveChunkUid(fileUid, manifestKey, chunkIndex);
  return `${vaultUid}/${chunkUid}`;
}

/**
 * Get storage paths for every chunk of a file
 */
export function getFileChunkPaths(
  vaultUid: string,
  fileUid: string,
  manifestKey: string,
  chunkCount: number
): Promise<string[]> {
  return Promise.all(
    Array.from({ length: chunkCount }, (_, i) =>
      getChunkPath(vaultUid, fileUid, manifestKey, i)
    )
  );
}

/**
 * Hand a Blob to the browser as a download with the given filename
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Large blobs take a moment to be picked up by the download manager
  setTimeout(() => URL.revokeObjectURL(url), 7000);
}

/**
 * Get encrypted chunk size (original + nonce + auth tag)
 * XChaCha20-Poly1305: 24-byte nonce + 16-byte auth tag
 */
export function getEncryptedChunkSize(originalSize: number): number {
  return originalSize + 24 + 16;
}

/**
 * Calculate total encrypted size for a file
 */
export function calculateEncryptedSize(fileSize: number): number {
  const chunkCount = calculateChunkCount(fileSize);
  const lastChunkSize = fileSize % CHUNK_SIZE || CHUNK_SIZE;
  const fullChunks = chunkCount - 1;

  // Full chunks + overhead for each
  const fullChunksSize = fullChunks * getEncryptedChunkSize(CHUNK_SIZE);
  // Last chunk + overhead
  const lastChunkEncryptedSize = getEncryptedChunkSize(lastChunkSize);

  return fullChunksSize + lastChunkEncryptedSize;
}
