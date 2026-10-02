/**
 * @module hooks/useUpload
 * @description Hook managing the upload queue — file chunking, encryption,
 * concurrent chunk uploads with retry and offline pausing, in-session resume
 * of failed uploads, manifest updates, and sweeping of stale upload records.
 */
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";
import type { UploadItem } from "../types/types";
import {
  MAX_CONCURRENT_UPLOADS,
  MAX_CONCURRENT_CHUNKS,
  STALE_UPLOAD_AGE_MS,
} from "../types/types";
import { generateFileUid } from "../utils/crypto";
import {
  calculateChunkCount,
  readChunk,
  encryptChunk,
  chunkAad,
  getChunkPath,
  getFileChunkPaths,
} from "../utils/chunks";
import { createFileEntry, addEntry, getUniqueName } from "../utils/manifest";
import { STORAGE_BUCKET, TABLES } from "../utils/supabase";
import {
  getTransferSignal,
  linkedSignal,
  throwIfAborted,
  abortError,
  isAbortError,
  isAlreadyExistsError,
  withRetry,
  removeChunkPaths,
} from "../utils/transfer";
import { uploadLogger } from "../utils/logger";

interface UseUploadReturn {
  uploadQueue: UploadItem[];
  addToQueue: (files: File[], parentId: string | null) => void;
  cancelUpload: (id: string) => void;
  retryUpload: (id: string) => void;
  clearCompleted: () => void;
  isUploading: boolean;
}

// Per-item progress that survives a failed attempt so a retry can continue
interface UploadTrack {
  uploaded: Set<number>;
  recordCreated: boolean;
  controller: AbortController;
}

export function useUpload(): UseUploadReturn {
  const {
    getClient,
    getEncryptionKey,
    getManifestKey,
    vaultUid,
    canWrite,
    updateManifest,
    updateStorageUsed,
  } = useVault();
  const { showToast } = useToast();
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const uploadQueueRef = useRef<UploadItem[]>([]);
  // Keep the ref in sync at commit so async callbacks read the latest queue
  useLayoutEffect(() => {
    uploadQueueRef.current = uploadQueue;
  });
  const activeUploadsRef = useRef(0);
  const cancelledRef = useRef(new Set<string>());
  const processingRef = useRef(new Set<string>());
  const tracksRef = useRef(new Map<string, UploadTrack>());
  const sweptVaultRef = useRef<string | null>(null);

  const requireClient = useCallback(() => {
    const client = getClient();
    if (!client) throw abortError();
    return client;
  }, [getClient]);

  const patchItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploadQueue((queue) =>
      queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setUploadQueue((queue) => queue.filter((q) => q.id !== id));
  }, []);

  // Delete every chunk path the file could have written (paths are
  // deterministic; missing ones are ignored by storage) plus its upload record
  const cleanupIncompleteUpload = useCallback(
    async (file_uid: string, totalChunks: number, manifestKey: string) => {
      const client = getClient();
      if (!client || !vaultUid) return;

      const paths = await getFileChunkPaths(
        vaultUid,
        file_uid,
        manifestKey,
        totalChunks
      );
      const { failed } = await removeChunkPaths(client, paths);
      if (failed > 0) {
        uploadLogger.error("Incomplete upload chunk delete failed:", {
          fileUid: file_uid,
          failedBatches: failed,
        });
        // Leave the record so the stale sweep finds the chunks later
        return;
      }

      const { error: deleteError } = await client
        .from(TABLES.UPLOADS)
        .delete()
        .eq("file_uid", file_uid);
      if (deleteError) {
        uploadLogger.error("Incomplete upload record delete failed:", {
          code: deleteError.code,
          message: deleteError.message,
          details: deleteError.details,
          hint: deleteError.hint,
        });
      }
    },
    [getClient, vaultUid]
  );

  const updateProgress = (
    id: string,
    completed: number,
    total: number,
    sessionStart: number,
    sessionStartCompleted: number
  ) => {
    setUploadQueue((queue) =>
      queue.map((item) => {
        if (item.id !== id) return item;

        const progress = Math.round((completed / total) * 100);
        const elapsed = Date.now() - sessionStart;
        const bytesThisSession =
          ((completed - sessionStartCompleted) / total) * item.file.size;
        const speed = elapsed > 0 ? bytesThisSession / (elapsed / 1000) : 0;

        return {
          ...item,
          chunksUploaded: completed,
          progress,
          speed,
          status: "uploading" as const,
        };
      })
    );
  };

  const uploadFile = async (item: UploadItem, manifestKey: string) => {
    const { file, file_uid, totalChunks, parentId } = item;
    let addedToManifest = false;

    // Resume from whatever an earlier attempt confirmed
    const track: UploadTrack = tracksRef.current.get(item.id) ?? {
      uploaded: new Set<number>(),
      recordCreated: false,
      controller: new AbortController(),
    };
    track.controller = new AbortController();
    tracksRef.current.set(item.id, track);
    const signal = linkedSignal(track.controller.signal);

    const onWait = (waiting: boolean) =>
      patchItem(item.id, { status: waiting ? "paused" : "uploading" });

    try {
      uploadLogger.log("Starting upload:", {
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        parentId,
        alreadyUploaded: track.uploaded.size,
      });

      // Create upload record for resumability
      if (!track.recordCreated) {
        await withRetry(
          async () => {
            const { error } = await requireClient()
              .from(TABLES.UPLOADS)
              .insert({
                vault_uid: vaultUid,
                file_uid,
                total_chunks: totalChunks,
                received_chunks: [],
              });

            if (error) {
              uploadLogger.error("Upload record insert failed:", {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
              });
              throw error;
            }
          },
          { signal, onWait }
        );
        track.recordCreated = true;
      }

      const sessionStart = Date.now();
      const sessionStartCompleted = track.uploaded.size;
      let completedChunks = track.uploaded.size;
      const chunkQueue = Array.from(
        { length: totalChunks },
        (_, i) => i
      ).filter((i) => !track.uploaded.has(i));

      // First hard failure stops the other workers via the item signal
      let failure: unknown = null;
      const fail = (err: unknown) => {
        if (failure === null) {
          failure = err;
          track.controller.abort();
        }
      };

      const uploadChunk = async (chunkIndex: number) => {
        throwIfAborted(signal);
        const encryptionKey = getEncryptionKey();
        if (!encryptionKey) throw abortError();

        const chunk = await readChunk(file, chunkIndex);
        const encrypted = await encryptChunk(
          chunk,
          encryptionKey,
          chunkAad(file_uid, chunkIndex)
        );
        // Logout aborts before wiping the key; never upload past that point
        throwIfAborted(signal);

        const path = await getChunkPath(
          vaultUid!,
          file_uid,
          manifestKey,
          chunkIndex
        );

        // Read the client per request so a rotated session token is used
        const client = requireClient();
        const { error } = await client.storage
          .from(STORAGE_BUCKET)
          .upload(path, encrypted, {
            contentType: "application/octet-stream",
            upsert: false,
          });

        // An existing object can only be our own earlier attempt whose
        // response was lost (file_uid is random per queue item, and storage
        // creates the object row only after the body is fully stored)
        if (error && !isAlreadyExistsError(error)) {
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

        // Record receipt on the server (idempotent)
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
      };

      const worker = async (): Promise<void> => {
        while (chunkQueue.length > 0) {
          throwIfAborted(signal);
          const chunkIndex = chunkQueue.shift()!;

          await withRetry(() => uploadChunk(chunkIndex), {
            signal,
            onWait,
            onRetry: (attempt, err) =>
              uploadLogger.log("Retrying chunk upload:", {
                chunkIndex,
                attempt,
                error: err instanceof Error ? err.message : err,
              }),
          });

          track.uploaded.add(chunkIndex);
          completedChunks++;
          updateProgress(
            item.id,
            completedChunks,
            totalChunks,
            sessionStart,
            sessionStartCompleted
          );
        }
      };

      const workers = Array.from(
        { length: Math.min(MAX_CONCURRENT_CHUNKS, chunkQueue.length) },
        () => worker().catch(fail)
      );

      // Wait for every worker to settle so no chunk lands after the item is
      // marked failed
      await Promise.all(workers);
      if (failure !== null) throw failure;
      throwIfAborted(signal);

      // Add to manifest atomically using updater function
      let finalName = file.name;
      await updateManifest((currentManifest) => {
        finalName = getUniqueName(currentManifest, file.name, parentId, false);
        const fileEntry = createFileEntry(
          finalName,
          parentId,
          file_uid,
          file.size,
          totalChunks,
          file.type || "application/octet-stream"
        );
        return addEntry(currentManifest, fileEntry);
      });
      addedToManifest = true;

      uploadLogger.log("File added to vault manifest:", {
        fileName: finalName,
        fileUid: file_uid,
        fileSize: file.size,
      });

      // Delete upload record (complete)
      const { error: deleteError } = await requireClient()
        .from(TABLES.UPLOADS)
        .delete()
        .eq("file_uid", file_uid);

      if (deleteError) {
        uploadLogger.error("Upload record delete failed:", {
          code: deleteError.code,
          message: deleteError.message,
          details: deleteError.details,
          hint: deleteError.hint,
        });
      }

      tracksRef.current.delete(item.id);
      patchItem(item.id, { status: "completed", progress: 100 });

      // Update storage used
      updateStorageUsed(file.size);

      uploadLogger.log("Upload completed:", {
        fileName: finalName,
        fileUid: file_uid,
      });

      showToast(`Uploaded "${finalName}"`, "success");
    } catch (err) {
      const cancelled = cancelledRef.current.has(item.id);
      const loggedOut = getTransferSignal().aborted;

      if (cancelled && !addedToManifest) {
        uploadLogger.log("Upload cancelled:", {
          fileName: file.name,
          fileUid: file_uid,
        });
        tracksRef.current.delete(item.id);
        await cleanupIncompleteUpload(file_uid, totalChunks, manifestKey);
        removeItem(item.id);
      } else if (loggedOut || isAbortError(err)) {
        // Session is gone; the stale sweep reclaims the chunks later
        uploadLogger.log("Upload stopped by logout:", {
          fileName: file.name,
          fileUid: file_uid,
        });
        tracksRef.current.delete(item.id);
        removeItem(item.id);
      } else {
        const errorMessage =
          err instanceof Error ? err.message : "Upload failed";
        uploadLogger.error("Upload failed:", {
          fileName: file.name,
          fileUid: file_uid,
          uploadedChunks: track.uploaded.size,
          error: errorMessage,
        });
        // Keep chunks and record so Retry only sends what is missing
        patchItem(item.id, {
          status: "error",
          error: errorMessage,
          canRetry: !addedToManifest,
          uploadedChunks: Array.from(track.uploaded),
          recordCreated: track.recordCreated,
        });
        showToast(`Failed to upload "${file.name}"`, "error");
      }
    } finally {
      activeUploadsRef.current--;
      cancelledRef.current.delete(item.id);
      processingRef.current.delete(item.id);
      processQueue();
    }
  };

  // Process queue when items are added, retried, or uploads complete
  const processQueue = useCallback(async () => {
    const manifestKey = getManifestKey();
    if (!getClient() || !getEncryptionKey() || !vaultUid || !manifestKey) {
      return;
    }

    // Read from ref to get latest state (avoids stale closure)
    const currentQueue = uploadQueueRef.current;

    // Find pending items that aren't already being processed
    const pending = currentQueue.filter(
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
          ? {
              ...item,
              status: "uploading" as const,
              error: undefined,
              startTime: Date.now(),
            }
          : item
      )
    );

    // Start uploads (don't await)
    toStart.forEach((item) => {
      activeUploadsRef.current++;
      uploadFile(item, manifestKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getClient, getEncryptionKey, getManifestKey, vaultUid]);

  // Effect to process queue (any queue change; the call is cheap and idempotent)
  useEffect(() => {
    processQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadQueue]);

  // Once per unlock: reclaim chunks of upload records nobody can resume
  // (older than STALE_UPLOAD_AGE_MS, so a live session's upload is never hit)
  useEffect(() => {
    if (!vaultUid || !canWrite || sweptVaultRef.current === vaultUid) return;
    const client = getClient();
    const manifestKey = getManifestKey();
    if (!client || !manifestKey) return;
    sweptVaultRef.current = vaultUid;

    const sweep = async () => {
      const cutoff = new Date(Date.now() - STALE_UPLOAD_AGE_MS).toISOString();
      const { data, error } = await client
        .from(TABLES.UPLOADS)
        .select("file_uid,total_chunks")
        .lt("created_at", cutoff);

      if (error) {
        uploadLogger.error("Stale upload query failed:", {
          code: error.code,
          message: error.message,
        });
        return;
      }
      if (!data || data.length === 0) return;

      uploadLogger.log("Sweeping stale uploads:", { count: data.length });

      for (const record of data as {
        file_uid: string;
        total_chunks: number;
      }[]) {
        const paths = await getFileChunkPaths(
          vaultUid,
          record.file_uid,
          manifestKey,
          record.total_chunks
        );
        const { failed } = await removeChunkPaths(client, paths);
        if (failed > 0) continue;

        await client
          .from(TABLES.UPLOADS)
          .delete()
          .eq("file_uid", record.file_uid);
      }
    };

    sweep().catch((err) =>
      uploadLogger.error("Stale upload sweep failed:", {
        error: err instanceof Error ? err.message : err,
      })
    );
  }, [vaultUid, canWrite, getClient, getManifestKey]);

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
      uploadedChunks: [],
      recordCreated: false,
    }));

    uploadLogger.log("Files queued for upload:", {
      count: files.length,
      files: files.map((f) => ({ name: f.name, size: f.size })),
      parentId,
    });

    setUploadQueue((prev) => [...prev, ...newItems]);
  }, []);

  const cancelUpload = useCallback(
    (id: string) => {
      const item = uploadQueueRef.current.find((q) => q.id === id);
      if (!item) return;

      if (
        item.status === "pending" ||
        item.status === "uploading" ||
        item.status === "paused"
      ) {
        // Running: the worker observes the abort and cleans up
        cancelledRef.current.add(id);
        tracksRef.current.get(id)?.controller.abort();
        if (item.status === "pending" && !processingRef.current.has(id)) {
          removeItem(id);
        }
        return;
      }

      // Errored with kept chunks: discard them now
      const manifestKey = getManifestKey();
      tracksRef.current.delete(id);
      removeItem(id);
      if (item.canRetry && manifestKey) {
        cleanupIncompleteUpload(item.file_uid, item.totalChunks, manifestKey);
      }
    },
    [getManifestKey, cleanupIncompleteUpload, removeItem]
  );

  const retryUpload = useCallback(
    (id: string) => {
      cancelledRef.current.delete(id);
      patchItem(id, {
        status: "pending",
        error: undefined,
        canRetry: undefined,
      });
    },
    [patchItem]
  );

  const clearCompleted = useCallback(() => {
    const manifestKey = getManifestKey();
    for (const item of uploadQueueRef.current) {
      if (item.status === "error" && item.canRetry && manifestKey) {
        tracksRef.current.delete(item.id);
        cleanupIncompleteUpload(item.file_uid, item.totalChunks, manifestKey);
      }
    }
    setUploadQueue((queue) =>
      queue.filter(
        (item) => item.status !== "completed" && item.status !== "error"
      )
    );
  }, [getManifestKey, cleanupIncompleteUpload]);

  const isUploading = uploadQueue.some(
    (item) =>
      item.status === "uploading" ||
      item.status === "pending" ||
      item.status === "paused"
  );

  return {
    uploadQueue,
    addToQueue,
    cancelUpload,
    retryUpload,
    clearCompleted,
    isUploading,
  };
}
