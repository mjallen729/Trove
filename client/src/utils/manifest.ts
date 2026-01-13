import type { ManifestEntry, VaultManifest } from "../types/types";
import { generateFileUid } from "./crypto";
import { MAX_FILE_NAME_LENGTH } from "../types/types";

/**
 * Create a new folder entry
 */
export function createFolder(name: string, parent: string | null): ManifestEntry {
  return {
    id: generateFileUid(),
    name: truncateName(name),
    type: "folder",
    parent,
    created_at: new Date().toISOString(),
  };
}

/**
 * Create a new file entry
 */
export function createFileEntry(
  name: string,
  parent: string | null,
  fileUid: string,
  size: number,
  chunkCount: number,
  mimeType: string
): ManifestEntry {
  return {
    id: generateFileUid(),
    name: truncateName(name),
    type: "file",
    parent,
    file_uid: fileUid,
    size,
    chunk_count: chunkCount,
    mime_type: mimeType,
    created_at: new Date().toISOString(),
  };
}

/**
 * Truncate file/folder name to max length
 */
function truncateName(name: string): string {
  if (name.length <= MAX_FILE_NAME_LENGTH) return name;

  // Preserve extension for files
  const lastDot = name.lastIndexOf(".");
  if (lastDot > 0 && lastDot > name.length - 10) {
    const ext = name.slice(lastDot);
    const baseName = name.slice(0, MAX_FILE_NAME_LENGTH - ext.length - 3);
    return `${baseName}...${ext}`;
  }

  return name.slice(0, MAX_FILE_NAME_LENGTH - 3) + "...";
}

/**
 * Add entry to manifest
 */
export function addEntry(manifest: VaultManifest, entry: ManifestEntry): VaultManifest {
  return [...manifest, entry];
}

/**
 * Add multiple entries to manifest
 */
export function addEntries(
  manifest: VaultManifest,
  entries: ManifestEntry[]
): VaultManifest {
  return [...manifest, ...entries];
}

/**
 * Remove entry from manifest (recursive for folders)
 * Returns the updated manifest and list of removed file entries (for storage cleanup)
 */
export function removeEntry(
  manifest: VaultManifest,
  entryId: string
): { manifest: VaultManifest; removedFiles: ManifestEntry[] } {
  const entry = manifest.find((e) => e.id === entryId);
  if (!entry) return { manifest, removedFiles: [] };

  // Collect all IDs to remove (entry + descendants if folder)
  const idsToRemove = new Set<string>([entryId]);
  const removedFiles: ManifestEntry[] = [];

  if (entry.type === "file") {
    removedFiles.push(entry);
  }

  if (entry.type === "folder") {
    const collectDescendants = (parentId: string) => {
      manifest.forEach((e) => {
        if (e.parent === parentId) {
          idsToRemove.add(e.id);
          if (e.type === "file") {
            removedFiles.push(e);
          } else {
            collectDescendants(e.id);
          }
        }
      });
    };
    collectDescendants(entryId);
  }

  const newManifest = manifest.filter((e) => !idsToRemove.has(e.id));
  return { manifest: newManifest, removedFiles };
}

/**
 * Remove multiple entries from manifest
 */
export function removeEntries(
  manifest: VaultManifest,
  entryIds: string[]
): { manifest: VaultManifest; removedFiles: ManifestEntry[] } {
  let currentManifest = manifest;
  const allRemovedFiles: ManifestEntry[] = [];

  for (const id of entryIds) {
    const result = removeEntry(currentManifest, id);
    currentManifest = result.manifest;
    allRemovedFiles.push(...result.removedFiles);
  }

  return { manifest: currentManifest, removedFiles: allRemovedFiles };
}

/**
 * Get all file entries that would be deleted (for storage calculation)
 */
export function getFilesInEntry(
  manifest: VaultManifest,
  entryId: string
): ManifestEntry[] {
  const entry = manifest.find((e) => e.id === entryId);
  if (!entry) return [];

  if (entry.type === "file") return [entry];

  const files: ManifestEntry[] = [];
  const collectFiles = (parentId: string) => {
    manifest.forEach((e) => {
      if (e.parent === parentId) {
        if (e.type === "file") {
          files.push(e);
        } else {
          collectFiles(e.id);
        }
      }
    });
  };
  collectFiles(entryId);
  return files;
}

/**
 * Rename an entry
 */
export function renameEntry(
  manifest: VaultManifest,
  entryId: string,
  newName: string
): VaultManifest {
  return manifest.map((e) =>
    e.id === entryId ? { ...e, name: truncateName(newName) } : e
  );
}

/**
 * Move entry to new parent
 */
export function moveEntry(
  manifest: VaultManifest,
  entryId: string,
  newParentId: string | null
): VaultManifest {
  return manifest.map((e) =>
    e.id === entryId ? { ...e, parent: newParentId } : e
  );
}

/**
 * Check if name exists in folder (case-insensitive)
 */
export function nameExistsInFolder(
  manifest: VaultManifest,
  name: string,
  parentId: string | null,
  excludeId?: string
): boolean {
  return manifest.some(
    (e) =>
      e.parent === parentId &&
      e.name.toLowerCase() === name.toLowerCase() &&
      e.id !== excludeId
  );
}

/**
 * Get unique name for entry (append number if needed)
 */
export function getUniqueName(
  manifest: VaultManifest,
  name: string,
  parentId: string | null,
  isFolder: boolean
): string {
  if (!nameExistsInFolder(manifest, name, parentId)) {
    return name;
  }

  let counter = 1;
  let uniqueName: string;

  if (isFolder) {
    do {
      uniqueName = `${name} (${counter})`;
      counter++;
    } while (nameExistsInFolder(manifest, uniqueName, parentId));
  } else {
    const lastDot = name.lastIndexOf(".");
    const baseName = lastDot > 0 ? name.slice(0, lastDot) : name;
    const ext = lastDot > 0 ? name.slice(lastDot) : "";

    do {
      uniqueName = `${baseName} (${counter})${ext}`;
      counter++;
    } while (nameExistsInFolder(manifest, uniqueName, parentId));
  }

  return uniqueName;
}

/**
 * Get entries in folder (sorted: folders first, then files, alphabetically)
 */
export function getEntriesInFolder(
  manifest: VaultManifest,
  folderId: string | null
): ManifestEntry[] {
  return manifest
    .filter((entry) => entry.parent === folderId)
    .sort((a, b) => {
      // Folders first
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
}

/**
 * Get breadcrumb path for folder
 */
export function getBreadcrumbPath(
  manifest: VaultManifest,
  folderId: string | null
): { id: string | null; name: string }[] {
  const path: { id: string | null; name: string }[] = [
    { id: null, name: "My Vault" },
  ];

  let current = folderId;
  const folders: ManifestEntry[] = [];

  while (current) {
    const folder = manifest.find((e) => e.id === current && e.type === "folder");
    if (folder) {
      folders.unshift(folder);
      current = folder.parent;
    } else {
      break;
    }
  }

  folders.forEach((f) => path.push({ id: f.id, name: f.name }));
  return path;
}

/**
 * Get total size of files in manifest
 */
export function getTotalSize(manifest: VaultManifest): number {
  return manifest.reduce((total, entry) => {
    if (entry.type === "file" && entry.size) {
      return total + entry.size;
    }
    return total;
  }, 0);
}

/**
 * Get file count in manifest
 */
export function getFileCount(manifest: VaultManifest): number {
  return manifest.filter((e) => e.type === "file").length;
}

/**
 * Get folder count in manifest
 */
export function getFolderCount(manifest: VaultManifest): number {
  return manifest.filter((e) => e.type === "folder").length;
}

/**
 * Check if entry is descendant of folder
 */
export function isDescendantOf(
  manifest: VaultManifest,
  entryId: string,
  ancestorId: string
): boolean {
  const entry = manifest.find((e) => e.id === entryId);
  if (!entry || !entry.parent) return false;
  if (entry.parent === ancestorId) return true;
  return isDescendantOf(manifest, entry.parent, ancestorId);
}
