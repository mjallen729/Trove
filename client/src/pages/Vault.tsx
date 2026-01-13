import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";
import { useUpload } from "../hooks/useUpload";
import { useDownload } from "../hooks/useDownload";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { Button } from "../components/ui/Button";
import { FileList } from "../components/FileList";
import { FolderBreadcrumbs } from "../components/FolderBreadcrumbs";
import { ConfirmModal } from "../components/ConfirmModal";
import { UploadQueue } from "../components/UploadQueue";
import {
  UploadDropzone,
  type FolderUploadInfo,
} from "../components/UploadDropzone";
import { IdleTimeoutModal } from "../components/IdleTimeoutModal";
import type { ManifestEntry } from "../types/types";
import {
  createFolder,
  addEntry,
  addEntries,
  removeEntries,
  getUniqueName,
} from "../utils/manifest";
import { getChunkPath } from "../utils/chunks";
import { STORAGE_BUCKET } from "../utils/supabase";
import { deleteLogger } from "../utils/logger";

export function Vault() {
  const navigate = useNavigate();
  const {
    logout,
    manifest,
    updateManifest,
    storageUsed,
    storageLimit,
    burnAt,
    vaultUid,
    getClient,
    getChunkPathPepper,
    updateStorageUsed,
  } = useVault();
  const { showToast } = useToast();
  const { uploadQueue, addToQueue, cancelUpload, clearCompleted } = useUpload();
  const { downloadFile } = useDownload();
  const { showWarning, remainingSeconds, stayLoggedIn } = useIdleTimeout();
  useNetworkStatus(); // Auto-logout on network drop

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ManifestEntry[] | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1000;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const storagePercent = (storageUsed / storageLimit) * 100;

  // Handlers
  const handleLogout = useCallback(async () => {
    await logout();
    showToast("Logged out successfully", "info");
    navigate("/");
  }, [logout, navigate, showToast]);

  const handleNavigate = useCallback((folderId: string | null) => {
    setCurrentFolderId(folderId);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) {
      setShowNewFolderInput(false);
      return;
    }

    const uniqueName = getUniqueName(
      manifest,
      newFolderName.trim(),
      currentFolderId,
      true
    );
    const folder = createFolder(uniqueName, currentFolderId);
    const newManifest = addEntry(manifest, folder);

    try {
      await updateManifest(newManifest);
      showToast(`Created folder "${uniqueName}"`, "success");
    } catch {
      showToast("Failed to create folder", "error");
    }

    setNewFolderName("");
    setShowNewFolderInput(false);
  }, [newFolderName, manifest, currentFolderId, updateManifest, showToast]);

  const handleDownload = useCallback(
    (file: ManifestEntry) => {
      downloadFile(file);
    },
    [downloadFile]
  );

  const handleDelete = useCallback((entries: ManifestEntry[]) => {
    setDeleteTarget(entries);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || !vaultUid) return;

    const client = getClient();
    const chunkPathPepper = getChunkPathPepper();
    if (!client || !chunkPathPepper) return;

    deleteLogger.log("Starting delete:", {
      targetCount: deleteTarget.length,
      targets: deleteTarget.map((e) => ({
        name: e.name,
        type: e.type,
        id: e.id,
      })),
    });

    setIsDeleting(true);
    try {
      const { manifest: newManifest, removedFiles } = removeEntries(
        manifest,
        deleteTarget.map((e) => e.id)
      );

      deleteLogger.log("Entries removed from manifest:", {
        removedFileCount: removedFiles.length,
        removedFiles: removedFiles.map((f) => ({
          name: f.name,
          file_uid: f.file_uid,
          chunk_count: f.chunk_count,
        })),
      });

      // Delete blobs from storage
      const chunkPaths: string[] = [];
      for (const file of removedFiles) {
        if (file.file_uid && file.chunk_count) {
          for (let i = 0; i < file.chunk_count; i++) {
            const path = await getChunkPath(
              vaultUid,
              file.file_uid,
              chunkPathPepper,
              i
            );
            chunkPaths.push(path);
          }
        }
      }

      if (chunkPaths.length > 0) {
        deleteLogger.log("Deleting storage blobs:", {
          chunkCount: chunkPaths.length,
        });

        const { error: storageError } = await client.storage
          .from(STORAGE_BUCKET)
          .remove(chunkPaths);

        if (storageError) {
          deleteLogger.error("Storage delete failed:", {
            message: storageError.message,
            name: storageError.name,
          });
        } else {
          deleteLogger.log("Storage blobs deleted successfully");
        }
      }

      await updateManifest(newManifest);

      // Update storage used (subtract deleted file sizes)
      const deletedBytes = removedFiles.reduce(
        (sum, f) => sum + (f.size || 0),
        0
      );
      if (deletedBytes > 0) {
        updateStorageUsed(-deletedBytes);
      }

      deleteLogger.log("Delete completed:", {
        deletedCount: deleteTarget.length,
        freedBytes: deletedBytes,
      });

      showToast(
        `Deleted ${deleteTarget.length} item${deleteTarget.length !== 1 ? "s" : ""}`,
        "success"
      );
    } catch (err) {
      deleteLogger.error("Delete failed:", {
        error: err instanceof Error ? err.message : err,
      });
      showToast("Failed to delete items", "error");
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [
    deleteTarget,
    manifest,
    updateManifest,
    showToast,
    vaultUid,
    getClient,
    getChunkPathPepper,
    updateStorageUsed,
  ]);

  const handleFilesDropped = useCallback(
    async (files: File[], folderInfo?: FolderUploadInfo) => {
      if (folderInfo) {
        // Create folder structure from dropped folder
        const uniqueFolderName = getUniqueName(
          manifest,
          folderInfo.name,
          currentFolderId,
          true
        );
        const rootFolder = createFolder(uniqueFolderName, currentFolderId);

        // Map relative paths to folder IDs
        const folderMap = new Map<string, string>();
        folderMap.set("", rootFolder.id);

        const foldersToCreate: ManifestEntry[] = [rootFolder];

        // Create all needed subfolders
        for (const [, relativePath] of folderInfo.relativePaths) {
          const pathParts = relativePath.split("/");
          pathParts.pop(); // Remove filename, keep only directory parts

          let currentPath = "";
          let parentId = rootFolder.id;

          for (const part of pathParts) {
            const newPath = currentPath ? `${currentPath}/${part}` : part;

            if (!folderMap.has(newPath)) {
              const subFolder = createFolder(part, parentId);
              folderMap.set(newPath, subFolder.id);
              foldersToCreate.push(subFolder);
            }

            parentId = folderMap.get(newPath)!;
            currentPath = newPath;
          }
        }

        // Update manifest with all folders
        try {
          await updateManifest(addEntries(manifest, foldersToCreate));
        } catch {
          showToast("Failed to create folder structure", "error");
          return;
        }

        // Add files to queue with correct parent IDs
        for (const [file, relativePath] of folderInfo.relativePaths) {
          const pathParts = relativePath.split("/");
          pathParts.pop(); // Remove filename
          const parentPath = pathParts.join("/");
          const parentId = folderMap.get(parentPath) || rootFolder.id;

          addToQueue([file], parentId);
        }
      } else {
        // Normal file upload to current folder
        addToQueue(files, currentFolderId);
      }
    },
    [addToQueue, currentFolderId, manifest, updateManifest, showToast]
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) {
        e.target.value = "";
        return;
      }

      // Check if this is a folder upload (files have webkitRelativePath)
      const firstFile = files[0];
      if (firstFile.webkitRelativePath) {
        // Extract root folder name from first file's path
        const rootFolderName = firstFile.webkitRelativePath.split("/")[0];

        // Build relativePaths map (remove root folder from path since we're creating it)
        const relativePaths = new Map<File, string>();
        for (const file of files) {
          const pathParts = file.webkitRelativePath.split("/");
          pathParts.shift(); // Remove root folder name
          relativePaths.set(file, pathParts.join("/"));
        }

        // Create folder structure
        const uniqueFolderName = getUniqueName(
          manifest,
          rootFolderName,
          currentFolderId,
          true
        );
        const rootFolder = createFolder(uniqueFolderName, currentFolderId);

        const folderMap = new Map<string, string>();
        folderMap.set("", rootFolder.id);

        const foldersToCreate: ManifestEntry[] = [rootFolder];

        for (const [, relativePath] of relativePaths) {
          const pathParts = relativePath.split("/");
          pathParts.pop(); // Remove filename

          let currentPath = "";
          let parentId = rootFolder.id;

          for (const part of pathParts) {
            if (!part) continue;
            const newPath = currentPath ? `${currentPath}/${part}` : part;

            if (!folderMap.has(newPath)) {
              const subFolder = createFolder(part, parentId);
              folderMap.set(newPath, subFolder.id);
              foldersToCreate.push(subFolder);
            }

            parentId = folderMap.get(newPath)!;
            currentPath = newPath;
          }
        }

        try {
          await updateManifest(addEntries(manifest, foldersToCreate));
        } catch {
          showToast("Failed to create folder structure", "error");
          e.target.value = "";
          return;
        }

        // Add files to queue with correct parent IDs
        for (const [file, relativePath] of relativePaths) {
          const pathParts = relativePath.split("/");
          pathParts.pop();
          const parentPath = pathParts.join("/");
          const parentId = folderMap.get(parentPath) || rootFolder.id;

          addToQueue([file], parentId);
        }
      } else {
        // Normal file upload
        addToQueue(files, currentFolderId);
      }

      e.target.value = "";
    },
    [addToQueue, currentFolderId, manifest, updateManifest, showToast]
  );

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <svg
                className="w-8 h-8 text-cyan-500"
                viewBox="0 0 24 24"
                fill="currentColor">
                <path d="M12 2C9.24 2 7 4.24 7 7v3H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2h-1V7c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3v3H9V7c0-1.66 1.34-3 3-3zm0 10c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z" />
              </svg>
              <span className="text-xl font-bold text-white">Trove</span>
            </div>

            {/* Breadcrumbs */}
            <FolderBreadcrumbs
              manifest={manifest}
              currentFolderId={currentFolderId}
              onNavigate={handleNavigate}
            />
          </div>

          <div className="flex items-center gap-4">
            {/* Storage indicator */}
            <div className="hidden sm:flex items-center gap-3">
              <div className="w-32 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all"
                  style={{ width: `${Math.min(storagePercent, 100)}%` }}
                />
              </div>
              <span className="text-sm text-gray-400">
                {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
              </span>
            </div>

            {/* Burn timer indicator */}
            {burnAt && (
              <div className="hidden sm:flex items-center gap-2 text-sm text-orange-400">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>Burns {new Date(burnAt).toLocaleDateString()}</span>
              </div>
            )}

            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="border-b border-gray-800 px-6 py-3 flex items-center gap-3">
        {showNewFolderInput ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setShowNewFolderInput(false);
                  setNewFolderName("");
                }
              }}
              placeholder="Folder name"
              autoFocus
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm
                         focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <Button variant="primary" size="sm" onClick={handleCreateFolder}>
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowNewFolderInput(false);
                setNewFolderName("");
              }}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowNewFolderInput(true)}>
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                />
              </svg>
              New folder
            </Button>

            <label className="cursor-pointer">
              <span className="inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 bg-gray-700 text-white hover:bg-gray-600 px-3 py-1.5 text-sm">
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Upload files
              </span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
            </label>

            <label className="cursor-pointer">
              <span className="inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 bg-gray-700 text-white hover:bg-gray-600 px-3 py-1.5 text-sm">
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                Upload folder
              </span>
              <input
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is a non-standard attribute
                webkitdirectory=""
                className="hidden"
                onChange={handleFileInputChange}
              />
            </label>
          </>
        )}
      </div>

      {/* File list with dropzone */}
      <UploadDropzone onFilesDropped={handleFilesDropped}>
        <main className="flex-1 px-6 py-4 min-h-[400px]">
          <FileList
            manifest={manifest}
            currentFolderId={currentFolderId}
            onNavigate={handleNavigate}
            onDownload={handleDownload}
            onDelete={handleDelete}
          />
        </main>
      </UploadDropzone>

      {/* Footer info */}
      <footer className="border-t border-gray-800 px-6 py-3 text-center text-xs text-gray-600">
        Vault ID: {vaultUid?.slice(0, 12)}
      </footer>

      {/* Upload queue */}
      <UploadQueue
        items={uploadQueue}
        onCancel={cancelUpload}
        onClearCompleted={clearCompleted}
      />

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete items"
          message={`Are you sure you want to delete ${deleteTarget.length} item${deleteTarget.length !== 1 ? "s" : ""}? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          isLoading={isDeleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Idle timeout warning modal */}
      {showWarning && (
        <IdleTimeoutModal
          remainingSeconds={remainingSeconds}
          onStayLoggedIn={stayLoggedIn}
        />
      )}
    </div>
  );
}
