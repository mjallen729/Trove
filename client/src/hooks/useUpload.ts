import { useState, useCallback, useRef, useEffect } from "react";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";
import type { UploadItem } from "../types/types";
import { MAX_CONCURRENT_UPLOADS, MAX_CONCURRENT_CHUNKS } from "../types/types";
import { generateFileUid } from "../utils/crypto";
import {
  calculateChunkCount,
  readChunk,
  encryptChunk,
  getChunkPath,
} from "../utils/chunks";
import { createFileEntry, addEntry, getUniqueName } from "../utils/schema";
import { STORAGE_BUCKET, TABLES } from "../utils/supabase";
import { uploadLogger } from "../utils/logger";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface UseUploadReturn {
  uploadQueue: UploadItem[];
  addToQueue: (files: File[], parentId: string | null) => void;
  cancelUpload: (id: string) => void;
  clearCompleted: () => void;
  isUploading: boolean;
}

export function useUpload(): UseUploadReturn {
  const { getClient, getEncryptionKey, vaultUid, schema, updateSchema } =
    useVault();
  const { showToast } = useToast();
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const activeUploadsRef = useRef(0);
  const cancelledRef = useRef(new Set<string>());
  const processingRef = useRef(new Set<string>());

  // Process queue when items are added or uploads complete
  const processQueue = useCallback(async () => {
    const client = getClient();
    const encryptionKey = getEncryptionKey();

    if (!client || !encryptionKey || !vaultUid) return;

    // Find pending items that aren't already being processed
    const pending = uploadQueue.filter(
      (item) => item.status === "pending" && !processingRef.current.has(item.id)
    );
    const canStart = MAX_CONCURRENT_UPLOADS - activeUploadsRef.current;

    if (canStart <= 0 || pending.length === 0) return;

    const toStart = pending.slice(0, canStart);

    // Mark as processing SYNCHRONOUSLY before any state updates
    toStart.forEach((item) => processingRef.current.add(item.id));

    // Mark as uploading in state
    setUploadQueue((queue) =>
      queue.map((item) =>
        toStart.some((s) => s.id === item.id)
          ? { ...item, status: "uploading" as const, startTime: Date.now() }
          : item
      )
    );

    // Start uploads (don't await)
    toStart.forEach((item) => {
      activeUploadsRef.current++;
      uploadFile(item, client, encryptionKey);
    });
  }, [getClient, getEncryptionKey, vaultUid, uploadQueue]);

  // Effect to process queue
  useEffect(() => {
    processQueue();
  }, [uploadQueue.length]);

  const uploadFile = async (
    item: UploadItem,
    client: NonNullable<ReturnType<typeof getClient>>,
    encryptionKey: Uint8Array
  ) => {
    const { file, file_uid, totalChunks, parentId } = item;

    try {
      uploadLogger.log("Starting upload:", {
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        parentId,
      });

      // Create upload record for resumability
      const { error: insertError } = await client.from(TABLES.UPLOADS).insert({
        vault_uid: vaultUid,
        file_uid,
        total_chunks: totalChunks,
        received_chunks: [],
      });

      if (insertError) {
        uploadLogger.error("Upload record insert failed:", {
          code: insertError.code,
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
        });
        throw insertError;
      }

      // Upload chunks with concurrency limit
      let completedChunks = 0;
      const uploadChunks: Promise<void>[] = [];
      const chunkQueue: number[] = Array.from(
        { length: totalChunks },
        (_, i) => i
      );

      const uploadNextChunk = async (): Promise<void> => {
        while (chunkQueue.length > 0) {
          // Check if cancelled
          if (cancelledRef.current.has(item.id)) {
            throw new Error("Upload cancelled");
          }

          const chunkIndex = chunkQueue.shift()!;
          let retries = 0;

          while (retries < MAX_RETRIES) {
            try {
              // Read and encrypt chunk
              const chunk = await readChunk(file, chunkIndex);
              const encrypted = await encryptChunk(chunk, encryptionKey);

              // Get storage path
              const path = await getChunkPath(vaultUid!, file_uid, chunkIndex);

              // Upload to storage
              const { error } = await client.storage
                .from(STORAGE_BUCKET)
                .upload(path, encrypted, {
                  contentType: "application/octet-stream",
                  upsert: false,
                });

              if (error) {
                uploadLogger.error("Storage upload error:", {
                  message: error.message,
                  name: error.name,
                  cause: error.cause,
                  path,
                  bucket: STORAGE_BUCKET,
                  chunkIndex,
                });
                throw error;
              }

              // Update received_chunks on server
              const { error: rpcError } = await client.rpc("append_received_chunk", {
                p_file_uid: file_uid,
                p_chunk_index: chunkIndex,
              });

              if (rpcError) {
                uploadLogger.error("RPC append_received_chunk failed:", {
                  code: rpcError.code,
                  message: rpcError.message,
                  details: rpcError.details,
                  hint: rpcError.hint,
                  chunkIndex,
                });
                throw rpcError;
              }

              completedChunks++;
              updateProgress(item.id, completedChunks, totalChunks);
              break; // Success, exit retry loop
            } catch (err) {
              retries++;
              // Check if cancelled before retrying
              if (cancelledRef.current.has(item.id)) {
                throw new Error("Upload cancelled");
              }
              if (retries >= MAX_RETRIES) {
                uploadLogger.error("Max retries exceeded for chunk:", {
                  chunkIndex,
                  retries,
                  error: err instanceof Error ? err.message : err,
                });
                throw err;
              }
              uploadLogger.log("Retrying chunk upload:", {
                chunkIndex,
                attempt: retries + 1,
                maxRetries: MAX_RETRIES,
              });
              // Wait before retry with exponential backoff
              await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * retries));
            }
          }
        }
      };

      // Start concurrent chunk uploads
      for (let i = 0; i < MAX_CONCURRENT_CHUNKS; i++) {
        uploadChunks.push(uploadNextChunk());
      }

      await Promise.all(uploadChunks);

      // Get unique name if needed
      const uniqueName = getUniqueName(schema, file.name, parentId, false);

      // Add to schema
      const fileEntry = createFileEntry(
        uniqueName,
        parentId,
        file_uid,
        file.size,
        totalChunks,
        file.type || "application/octet-stream"
      );

      const newSchema = addEntry(schema, fileEntry);
      await updateSchema(newSchema);

      uploadLogger.log("File added to vault schema:", {
        fileName: uniqueName,
        fileUid: file_uid,
        fileSize: file.size,
      });

      // Delete upload record (complete)
      const { error: deleteError } = await client.from(TABLES.UPLOADS).delete().eq("file_uid", file_uid);

      if (deleteError) {
        uploadLogger.error("Upload record delete failed:", {
          code: deleteError.code,
          message: deleteError.message,
          details: deleteError.details,
          hint: deleteError.hint,
        });
      }

      // Mark as completed
      setUploadQueue((queue) =>
        queue.map((q) =>
          q.id === item.id
            ? { ...q, status: "completed" as const, progress: 100 }
            : q
        )
      );

      uploadLogger.log("Upload completed:", {
        fileName: uniqueName,
        fileUid: file_uid,
      });

      showToast(`Uploaded "${uniqueName}"`, "success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Upload failed";

      if (errorMessage === "Upload cancelled") {
        uploadLogger.log("Upload cancelled:", { fileName: file.name, fileUid: file_uid });
        // Clean up cancelled upload
        const { error: cancelDeleteError } = await client.from(TABLES.UPLOADS).delete().eq("file_uid", file_uid);
        if (cancelDeleteError) {
          uploadLogger.error("Cancelled upload record delete failed:", {
            code: cancelDeleteError.code,
            message: cancelDeleteError.message,
            details: cancelDeleteError.details,
            hint: cancelDeleteError.hint,
          });
        }
        setUploadQueue((queue) => queue.filter((q) => q.id !== item.id));
      } else {
        uploadLogger.error("Upload failed:", {
          fileName: file.name,
          fileUid: file_uid,
          error: errorMessage,
        });
        setUploadQueue((queue) =>
          queue.map((q) =>
            q.id === item.id
              ? { ...q, status: "error" as const, error: errorMessage }
              : q
          )
        );
        showToast(`Failed to upload "${file.name}"`, "error");
      }
    } finally {
      activeUploadsRef.current--;
      cancelledRef.current.delete(item.id);
      processingRef.current.delete(item.id);
      processQueue();
    }
  };

  const updateProgress = (id: string, completed: number, total: number) => {
    setUploadQueue((queue) =>
      queue.map((item) => {
        if (item.id !== id) return item;

        const progress = Math.round((completed / total) * 100);
        const elapsed = Date.now() - (item.startTime || Date.now());
        const bytesUploaded = (completed / total) * item.file.size;
        const speed = elapsed > 0 ? bytesUploaded / (elapsed / 1000) : 0;

        return {
          ...item,
          chunksUploaded: completed,
          progress,
          speed,
        };
      })
    );
  };

  const addToQueue = useCallback((files: File[], parentId: string | null) => {
    const newItems: UploadItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      file_uid: generateFileUid(),
      parentId,
      progress: 0,
      status: "pending",
      chunksUploaded: 0,
      totalChunks: calculateChunkCount(file.size),
    }));

    uploadLogger.log("Files queued for upload:", {
      count: files.length,
      files: files.map((f) => ({ name: f.name, size: f.size })),
      parentId,
    });

    setUploadQueue((prev) => [...prev, ...newItems]);
  }, []);

  const cancelUpload = useCallback((id: string) => {
    cancelledRef.current.add(id);
    setUploadQueue((queue) =>
      queue.map((item) =>
        item.id === id &&
        (item.status === "pending" || item.status === "uploading")
          ? { ...item, status: "error" as const, error: "Cancelled" }
          : item
      )
    );
  }, []);

  const clearCompleted = useCallback(() => {
    setUploadQueue((queue) =>
      queue.filter(
        (item) => item.status !== "completed" && item.status !== "error"
      )
    );
  }, []);

  const isUploading = uploadQueue.some(
    (item) => item.status === "uploading" || item.status === "pending"
  );

  return {
    uploadQueue,
    addToQueue,
    cancelUpload,
    clearCompleted,
    isUploading,
  };
}
