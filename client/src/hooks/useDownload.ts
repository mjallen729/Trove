import { useState, useCallback } from "react";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";
import type { SchemaEntry, DownloadProgress } from "../types/types";
import {
  decryptChunk,
  getChunkPath,
  concatenateChunks,
  downloadBlob,
} from "../utils/chunks";
import { STORAGE_BUCKET } from "../utils/supabase";
import { downloadLogger } from "../utils/logger";

interface UseDownloadReturn {
  downloads: DownloadProgress[];
  downloadFile: (file: SchemaEntry) => Promise<void>;
  isDownloading: boolean;
}

export function useDownload(): UseDownloadReturn {
  const { getClient, getEncryptionKey, vaultUid } = useVault();
  const { showToast } = useToast();
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);

  const downloadFile = useCallback(
    async (file: SchemaEntry) => {
      if (file.type !== "file" || !file.file_uid || !file.chunk_count) {
        showToast("Invalid file", "error");
        return;
      }

      const client = getClient();
      const encryptionKey = getEncryptionKey();

      if (!client || !encryptionKey || !vaultUid) {
        showToast("Vault not unlocked", "error");
        return;
      }

      const downloadId = file.id;

      downloadLogger.log("Download started:", {
        fileName: file.name,
        fileUid: file.file_uid,
        chunkCount: file.chunk_count,
        fileSize: file.size,
      });

      // Add to downloads list
      setDownloads((prev) => [
        ...prev,
        {
          fileId: downloadId,
          fileName: file.name,
          progress: 0,
          status: "downloading",
        },
      ]);

      try {
        const chunks: Uint8Array[] = [];
        const totalChunks = file.chunk_count;

        // Download and decrypt each chunk
        for (let i = 0; i < totalChunks; i++) {
          const path = await getChunkPath(vaultUid, file.file_uid, i);

          const { data, error } = await client.storage
            .from(STORAGE_BUCKET)
            .download(path);

          if (error || !data) {
            downloadLogger.error("Storage download error:", {
              message: error?.message,
              name: error?.name,
              cause: error?.cause,
              path,
              bucket: STORAGE_BUCKET,
              chunkIndex: i,
            });
            throw new Error(`Failed to download chunk ${i + 1}/${totalChunks}`);
          }

          // Update progress (downloading)
          setDownloads((prev) =>
            prev.map((d) =>
              d.fileId === downloadId
                ? {
                    ...d,
                    progress: Math.round(((i + 0.5) / totalChunks) * 100),
                    status: "downloading",
                  }
                : d
            )
          );

          // Switch to decrypting status
          setDownloads((prev) =>
            prev.map((d) =>
              d.fileId === downloadId ? { ...d, status: "decrypting" } : d
            )
          );

          // Decrypt chunk
          const encryptedChunk = new Uint8Array(await data.arrayBuffer());
          const decryptedChunk = await decryptChunk(
            encryptedChunk,
            encryptionKey
          );
          chunks.push(decryptedChunk);

          // Update progress
          setDownloads((prev) =>
            prev.map((d) =>
              d.fileId === downloadId
                ? {
                    ...d,
                    progress: Math.round(((i + 1) / totalChunks) * 100),
                    status: "downloading",
                  }
                : d
            )
          );
        }

        // Concatenate chunks and trigger browser download
        const fileData = concatenateChunks(chunks);
        downloadBlob(
          fileData,
          file.name,
          file.mime_type || "application/octet-stream"
        );

        // Mark as completed
        setDownloads((prev) =>
          prev.map((d) =>
            d.fileId === downloadId
              ? { ...d, status: "completed", progress: 100 }
              : d
          )
        );

        downloadLogger.log("Download completed:", {
          fileName: file.name,
          fileUid: file.file_uid,
        });

        showToast(`Downloaded "${file.name}"`, "success");

        // Remove from list after delay
        setTimeout(() => {
          setDownloads((prev) => prev.filter((d) => d.fileId !== downloadId));
        }, 3000);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Download failed";

        downloadLogger.error("Download failed:", {
          fileName: file.name,
          fileUid: file.file_uid,
          error: errorMessage,
        });

        setDownloads((prev) =>
          prev.map((d) =>
            d.fileId === downloadId ? { ...d, status: "error" } : d
          )
        );

        showToast(
          `Failed to download "${file.name}": ${errorMessage}`,
          "error"
        );

        // Remove error after delay
        setTimeout(() => {
          setDownloads((prev) => prev.filter((d) => d.fileId !== downloadId));
        }, 5000);
      }
    },
    [getClient, getEncryptionKey, vaultUid, showToast]
  );

  const isDownloading = downloads.some(
    (d) => d.status === "downloading" || d.status === "decrypting"
  );

  return {
    downloads,
    downloadFile,
    isDownloading,
  };
}
