import type { SchemaEntry, VaultSchema } from "../types/types";
import { generateFileUid } from "./crypto";
import { MAX_FILE_NAME_LENGTH } from "../types/types";

/**
 * Create a new folder entry
 */
export function createFolder(name: string, parent: string | null): SchemaEntry {
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
): SchemaEntry {
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
 * Add entry to schema
 */
export function addEntry(schema: VaultSchema, entry: SchemaEntry): VaultSchema {
  return [...schema, entry];
}

/**
 * Add multiple entries to schema
 */
export function addEntries(
  schema: VaultSchema,
  entries: SchemaEntry[]
): VaultSchema {
  return [...schema, ...entries];
}

/**
 * Remove entry from schema (recursive for folders)
 * Returns the updated schema and list of removed file entries (for storage cleanup)
 */
export function removeEntry(
  schema: VaultSchema,
  entryId: string
): { schema: VaultSchema; removedFiles: SchemaEntry[] } {
  const entry = schema.find((e) => e.id === entryId);
  if (!entry) return { schema, removedFiles: [] };

  // Collect all IDs to remove (entry + descendants if folder)
  const idsToRemove = new Set<string>([entryId]);
  const removedFiles: SchemaEntry[] = [];

  if (entry.type === "file") {
    removedFiles.push(entry);
  }

  if (entry.type === "folder") {
    const collectDescendants = (parentId: string) => {
      schema.forEach((e) => {
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

  const newSchema = schema.filter((e) => !idsToRemove.has(e.id));
  return { schema: newSchema, removedFiles };
}

/**
 * Remove multiple entries from schema
 */
export function removeEntries(
  schema: VaultSchema,
  entryIds: string[]
): { schema: VaultSchema; removedFiles: SchemaEntry[] } {
  let currentSchema = schema;
  const allRemovedFiles: SchemaEntry[] = [];

  for (const id of entryIds) {
    const result = removeEntry(currentSchema, id);
    currentSchema = result.schema;
    allRemovedFiles.push(...result.removedFiles);
  }

  return { schema: currentSchema, removedFiles: allRemovedFiles };
}

/**
 * Get all file entries that would be deleted (for storage calculation)
 */
export function getFilesInEntry(
  schema: VaultSchema,
  entryId: string
): SchemaEntry[] {
  const entry = schema.find((e) => e.id === entryId);
  if (!entry) return [];

  if (entry.type === "file") return [entry];

  const files: SchemaEntry[] = [];
  const collectFiles = (parentId: string) => {
    schema.forEach((e) => {
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
  schema: VaultSchema,
  entryId: string,
  newName: string
): VaultSchema {
  return schema.map((e) =>
    e.id === entryId ? { ...e, name: truncateName(newName) } : e
  );
}

/**
 * Move entry to new parent
 */
export function moveEntry(
  schema: VaultSchema,
  entryId: string,
  newParentId: string | null
): VaultSchema {
  return schema.map((e) =>
    e.id === entryId ? { ...e, parent: newParentId } : e
  );
}

/**
 * Check if name exists in folder (case-insensitive)
 */
export function nameExistsInFolder(
  schema: VaultSchema,
  name: string,
  parentId: string | null,
  excludeId?: string
): boolean {
  return schema.some(
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
  schema: VaultSchema,
  name: string,
  parentId: string | null,
  isFolder: boolean
): string {
  if (!nameExistsInFolder(schema, name, parentId)) {
    return name;
  }

  let counter = 1;
  let uniqueName: string;

  if (isFolder) {
    do {
      uniqueName = `${name} (${counter})`;
      counter++;
    } while (nameExistsInFolder(schema, uniqueName, parentId));
  } else {
    const lastDot = name.lastIndexOf(".");
    const baseName = lastDot > 0 ? name.slice(0, lastDot) : name;
    const ext = lastDot > 0 ? name.slice(lastDot) : "";

    do {
      uniqueName = `${baseName} (${counter})${ext}`;
      counter++;
    } while (nameExistsInFolder(schema, uniqueName, parentId));
  }

  return uniqueName;
}

/**
 * Get entries in folder (sorted: folders first, then files, alphabetically)
 */
export function getEntriesInFolder(
  schema: VaultSchema,
  folderId: string | null
): SchemaEntry[] {
  return schema
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
  schema: VaultSchema,
  folderId: string | null
): { id: string | null; name: string }[] {
  const path: { id: string | null; name: string }[] = [
    { id: null, name: "My Vault" },
  ];

  let current = folderId;
  const folders: SchemaEntry[] = [];

  while (current) {
    const folder = schema.find((e) => e.id === current && e.type === "folder");
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
 * Get total size of files in schema
 */
export function getTotalSize(schema: VaultSchema): number {
  return schema.reduce((total, entry) => {
    if (entry.type === "file" && entry.size) {
      return total + entry.size;
    }
    return total;
  }, 0);
}

/**
 * Get file count in schema
 */
export function getFileCount(schema: VaultSchema): number {
  return schema.filter((e) => e.type === "file").length;
}

/**
 * Get folder count in schema
 */
export function getFolderCount(schema: VaultSchema): number {
  return schema.filter((e) => e.type === "folder").length;
}

/**
 * Check if entry is descendant of folder
 */
export function isDescendantOf(
  schema: VaultSchema,
  entryId: string,
  ancestorId: string
): boolean {
  const entry = schema.find((e) => e.id === entryId);
  if (!entry || !entry.parent) return false;
  if (entry.parent === ancestorId) return true;
  return isDescendantOf(schema, entry.parent, ancestorId);
}
