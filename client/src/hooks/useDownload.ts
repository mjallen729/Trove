/**
 * @module hooks/useDownload
 * @description Hook that downloads encrypted chunks with bounded concurrency,
 * decrypts them, and writes them in order to a file sink — streamed to disk
 * on Chromium, collected in memory (up to a cap) elsewhere.
 */
import { useState, useCallback, useRef } from "react";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";
import type { ManifestEntry, DownloadProgress } from "../types/types";
import {
  MAX_CONCURRENT_DOWNLOADS,
  DOWNLOAD_CHUNK_CONCURRENCY,
  CHUNK_ENC_VERSION,
} from "../types/types";
import { decryptChunk, chunkAad, getChunkPath } from "../utils/chunks";
import {
  type FileSink,
  FileTooLargeError,
  supportsDiskStreaming,
  pickSaveTargets,
  createDiskSink,
  createMemorySink,
} from "../utils/fileSink";
import {
  getTransferSignal,
  linkedSignal,
  throwIfAborted,
  abortError,
  isAbortError,
  withRetry,
} from "../utils/transfer";
import { STORAGE_BUCKET } from "../utils/supabase";
import { downloadLogger } from "../utils/logger";

interface UseDownloadReturn {
  downloads: DownloadProgress[];
  downloadFiles: (files: ManifestEntry[]) => Promise<void>;
  cancelDownload: (id: string) => void;
  clearCompletedDownloads: () => void;
  isDownloading: boolean;
}

interface DownloadJob {
  id: string;
  file: ManifestEntry;
  openSink: () => Promise<FileSink>;
}

const formatGiB = (bytes: number) => `${Math.round(bytes / 2 ** 30)} GB`;

export function useDownload(): UseDownloadReturn {
  const { getClient, getEncryptionKey, getManifestKey, vaultUid } = useVault();
  const { showToast } = useToast();
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const queueRef = useRef<DownloadJob[]>([]);
  const activeRef = useRef(0);
  const controllersRef = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, p: Partial<DownloadProgress>) => {
    setDownloads((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  }, []);

  const runJob = async (job: DownloadJob) => {
    const { file } = job;
    const totalChunks = file.chunk_count!;
    const fileUid = file.file_uid!;
    const controller = new AbortController();
    controllersRef.current.set(job.id, controller);
    const signal = linkedSignal(controller.signal);

    // Legacy entries (no enc_v) were encrypted without associated data
    const aadFor = (i: number) =>
      (file.enc_v ?? 1) >= CHUNK_ENC_VERSION ? chunkAad(fileUid, i) : null;

    let sink: FileSink | null = null;
    const start = Date.now();
    let bytesDone = 0;

    downloadLogger.log("Download started:", {
      fileName: file.name,
      fileUid,
      chunkCount: totalChunks,
      fileSize: file.size,
    });

    const fetchChunk = async (i: number): Promise<Uint8Array> => {
      const manifestKey = getManifestKey();
      if (!vaultUid || !manifestKey) throw abortError();
      const path = await getChunkPath(vaultUid, fileUid, manifestKey, i);

      const bytes = await withRetry(
        async () => {
          throwIfAborted(signal);
          // Read the client per request so a rotated session token is used
          const client = getClient();
          if (!client) throw abortError();

          const { data, error } = await client.storage
            .from(STORAGE_BUCKET)
            .download(path, {}, { signal });

          if (error || !data) {
            downloadLogger.error("Storage download error:", {
              message: error?.message,
              name: error?.name,
              path,
              bucket: STORAGE_BUCKET,
              chunkIndex: i,
            });
            throw (
              error ??
              new Error(`Failed to download chunk ${i + 1}/${totalChunks}`)
            );
          }
          return new Uint8Array(await data.arrayBuffer());
        },
        {
          signal,
          onWait: (waiting) =>
            patch(job.id, { status: waiting ? "paused" : "downloading" }),
          onRetry: (attempt, err) =>
            downloadLogger.log("Retrying chunk download:", {
              chunkIndex: i,
              attempt,
              error: err instanceof Error ? err.message : err,
            }),
        }
      );

      // Decrypt outside the retry: a bad key or corrupt chunk is final
      const key = getEncryptionKey();
      if (!key) throw abortError();
      return decryptChunk(bytes, key, aadFor(i));
    };

    try {
      throwIfAborted(signal);
      sink = await job.openSink();
      patch(job.id, { status: "downloading" });

      // Keep DOWNLOAD_CHUNK_CONCURRENCY fetches in flight, write in order
      const inflight = new Map<number, Promise<Uint8Array>>();
      let next = 0;

      for (let writeIndex = 0; writeIndex < totalChunks; writeIndex++) {
        while (
          next < totalChunks &&
          inflight.size < DOWNLOAD_CHUNK_CONCURRENCY
        ) {
          const p = fetchChunk(next);
          // A rejection is observed when its turn comes; keep it from being
          // reported as unhandled before then
          p.catch(() => {});
          inflight.set(next, p);
          next++;
        }

        const chunk = await inflight.get(writeIndex)!;
        inflight.delete(writeIndex);
        throwIfAborted(signal);
        await sink.write(chunk);

        bytesDone += chunk.length;
        const elapsed = Date.now() - start;
        patch(job.id, {
          bytesDone,
          progress: Math.round(((writeIndex + 1) / totalChunks) * 100),
          speed: elapsed > 0 ? bytesDone / (elapsed / 1000) : 0,
        });
      }

      const finished = sink;
      sink = null;
      await finished.close();

      patch(job.id, { status: "completed", progress: 100 });
      downloadLogger.log("Download completed:", {
        fileName: file.name,
        fileUid,
      });
      showToast(`Downloaded "${file.name}"`, "success");
    } catch (err) {
      // Stop any fetches still in flight
      controller.abort();
      if (sink) await sink.abort().catch(() => {});

      if (isAbortError(err) || getTransferSignal().aborted) {
        downloadLogger.log("Download cancelled:", {
          fileName: file.name,
          fileUid,
        });
        patch(job.id, { status: "cancelled" });
      } else {
        const errorMessage =
          err instanceof Error ? err.message : "Download failed";
        downloadLogger.error("Download failed:", {
          fileName: file.name,
          fileUid,
          error: errorMessage,
        });
        patch(job.id, { status: "error", error: errorMessage });
        showToast(
          `Failed to download "${file.name}": ${errorMessage}`,
          "error"
        );
      }
    } finally {
      controllersRef.current.delete(job.id);
    }
  };

  const pump = () => {
    while (
      activeRef.current < MAX_CONCURRENT_DOWNLOADS &&
      queueRef.current.length > 0
    ) {
      const job = queueRef.current.shift()!;
      activeRef.current++;
      runJob(job).finally(() => {
        activeRef.current--;
        pump();
      });
    }
  };

  const downloadFiles = useCallback(
    async (files: ManifestEntry[]) => {
      const valid = files.filter(
        (f) => f.type === "file" && f.file_uid && f.chunk_count != null
      );
      if (valid.length === 0) {
        showToast("Invalid file", "error");
        return;
      }
      if (
        !getClient() ||
        !getEncryptionKey() ||
        !vaultUid ||
        !getManifestKey()
      ) {
        showToast("Vault not unlocked", "error");
        return;
      }

      let jobs: DownloadJob[];

      if (supportsDiskStreaming()) {
        // Must be the first await: the picker needs the click's activation
        const handles = await pickSaveTargets(valid.map((f) => f.name));
        if (!handles) return;

        jobs = valid.map((file, i) => ({
          id: crypto.randomUUID(),
          file,
          openSink: () => createDiskSink(handles[i]),
        }));
      } else {
        jobs = [];
        for (const file of valid) {
          try {
            const sink = createMemorySink(
              file.name,
              file.mime_type || "application/octet-stream",
              file.size ?? 0
            );
            jobs.push({
              id: crypto.randomUUID(),
              file,
              openSink: async () => sink,
            });
          } catch (err) {
            if (!(err instanceof FileTooLargeError)) throw err;
            showToast(
              `"${file.name}" is larger than ${formatGiB(err.limit)}, which this browser cannot download. Use Chrome or Edge for files this size.`,
              "error"
            );
          }
        }
        if (jobs.length === 0) return;
      }

      setDownloads((prev) => [
        ...prev,
        ...jobs.map<DownloadProgress>((job) => ({
          id: job.id,
          fileId: job.file.id,
          fileName: job.file.name,
          size: job.file.size ?? 0,
          progress: 0,
          bytesDone: 0,
          status: "pending",
        })),
      ]);
      queueRef.current.push(...jobs);
      pump();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getClient, getEncryptionKey, getManifestKey, vaultUid, showToast]
  );

  const cancelDownload = useCallback(
    (id: string) => {
      const queued = queueRef.current.findIndex((j) => j.id === id);
      if (queued >= 0) {
        queueRef.current.splice(queued, 1);
        patch(id, { status: "cancelled" });
        return;
      }
      controllersRef.current.get(id)?.abort();
    },
    [patch]
  );

  const clearCompletedDownloads = useCallback(() => {
    setDownloads((prev) =>
      prev.filter(
        (d) =>
          d.status !== "completed" &&
          d.status !== "error" &&
          d.status !== "cancelled"
      )
    );
  }, []);

  const isDownloading = downloads.some(
    (d) =>
      d.status === "downloading" ||
      d.status === "pending" ||
      d.status === "paused"
  );

  return {
    downloads,
    downloadFiles,
    cancelDownload,
    clearCompletedDownloads,
    isDownloading,
  };
}
