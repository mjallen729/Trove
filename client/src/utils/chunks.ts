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
 * Encrypt a chunk with unique nonce
 */
export async function encryptChunk(
  chunk: Uint8Array,
  encryptionKey: Uint8Array
): Promise<Uint8Array> {
  return encrypt(chunk, encryptionKey);
}

/**
 * Decrypt a chunk
 */
export async function decryptChunk(
  encryptedChunk: Uint8Array,
  encryptionKey: Uint8Array
): Promise<Uint8Array> {
  return decrypt(encryptedChunk, encryptionKey);
}

/**
 * Get storage path for a chunk
 */
export async function getChunkPath(
  vaultUid: string,
  fileUid: string,
  chunkPathPepper: string,
  chunkIndex: number
): Promise<string> {
  const chunkUid = await deriveChunkUid(fileUid, chunkPathPepper, chunkIndex);
  return `${vaultUid}/${chunkUid}`;
}

/**
 * Concatenate multiple chunks into a single Uint8Array
 */
export function concatenateChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Trigger browser download for decrypted file
 */
export function downloadBlob(
  data: Uint8Array,
  filename: string,
  mimeType: string
): void {
  // Create a new ArrayBuffer copy to ensure compatibility with Blob
  const arrayBuffer = new ArrayBuffer(data.length);
  new Uint8Array(arrayBuffer).set(data);
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Clean up after short delay
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
