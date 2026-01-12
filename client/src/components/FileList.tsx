import { useState, useCallback, useMemo } from "react";
import type { SchemaEntry } from "../types/types";
import { FileRow } from "./FileRow";
import { getEntriesInFolder } from "../utils/schema";
import { Button } from "./ui/Button";

interface FileListProps {
  schema: SchemaEntry[];
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
  onDownload: (file: SchemaEntry) => void;
  onDelete: (entries: SchemaEntry[]) => void;
}

export function FileList({
  schema,
  currentFolderId,
  onNavigate,
  onDownload,
  onDelete,
}: FileListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );

  // Get sorted entries for current folder
  const entries = useMemo(
    () => getEntriesInFolder(schema, currentFolderId),
    [schema, currentFolderId]
  );

  const handleSelect = useCallback(
    (entry: SchemaEntry, index: number, event: React.MouseEvent) => {
      const newSelected = new Set(selectedIds);

      if (event.shiftKey && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
          newSelected.add(entries[i].id);
        }
      } else if (event.ctrlKey || event.metaKey) {
        // Toggle selection
        if (newSelected.has(entry.id)) {
          newSelected.delete(entry.id);
        } else {
          newSelected.add(entry.id);
        }
      } else {
        // Single selection
        newSelected.clear();
        newSelected.add(entry.id);
      }

      setSelectedIds(newSelected);
      setLastSelectedIndex(index);
    },
    [selectedIds, lastSelectedIndex, entries]
  );

  const handleDoubleClick = useCallback(
    (entry: SchemaEntry) => {
      if (entry.type === "folder") {
        onNavigate(entry.id);
        setSelectedIds(new Set());
        setLastSelectedIndex(null);
      } else {
        onDownload(entry);
      }
    },
    [onNavigate, onDownload]
  );

  const handleDeleteSelected = useCallback(() => {
    const selected = entries.filter((e) => selectedIds.has(e.id));
    if (selected.length > 0) {
      onDelete(selected);
      setSelectedIds(new Set());
      setLastSelectedIndex(null);
    }
  }, [entries, selectedIds, onDelete]);

  const handleDownloadSelected = useCallback(() => {
    const selected = entries.filter(
      (e) => selectedIds.has(e.id) && e.type === "file"
    );
    selected.forEach(onDownload);
  }, [entries, selectedIds, onDownload]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(entries.map((e) => e.id)));
  }, [entries]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  }, []);

  // Empty state
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <svg
          className="w-20 h-20 mb-4 text-gray-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <h2 className="text-xl font-medium text-gray-300 mb-2">
          {currentFolderId ? "This folder is empty" : "Your vault is empty"}
        </h2>
        <p className="text-gray-500">
          Drop files here or use the upload buttons
        </p>
      </div>
    );
  }

  const selectedCount = selectedIds.size;
  const selectedFiles = entries.filter(
    (e) => selectedIds.has(e.id) && e.type === "file"
  );

  return (
    <div className="w-full">
      {/* Header row */}
      <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs text-gray-500 uppercase border-b border-gray-800">
        <div className="col-span-1">
          <input
            type="checkbox"
            checked={selectedIds.size === entries.length && entries.length > 0}
            onChange={(e) =>
              e.target.checked ? selectAll() : clearSelection()
            }
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-cyan-500
                       focus:ring-cyan-500 focus:ring-offset-gray-900"
          />
        </div>
        <div className="col-span-6">Name</div>
        <div className="col-span-2">Size</div>
        <div className="col-span-3">Modified</div>
      </div>

      {/* File rows */}
      <div className="divide-y divide-gray-800/50">
        {entries.map((entry, index) => (
          <FileRow
            key={entry.id}
            entry={entry}
            isSelected={selectedIds.has(entry.id)}
            onClick={(e) => handleSelect(entry, index, e)}
            onDoubleClick={() => handleDoubleClick(entry)}
          />
        ))}
      </div>

      {/* Selection action bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-xl shadow-lg px-4 py-3 flex items-center gap-4 animate-slide-up">
          <span className="text-sm text-gray-300">
            {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
          </span>

          {selectedFiles.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownloadSelected}>
              <svg
                className="w-4 h-4 mr-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Download
            </Button>
          )}

          <Button variant="danger" size="sm" onClick={handleDeleteSelected}>
            <svg
              className="w-4 h-4 mr-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete
          </Button>

          <button
            onClick={clearSelection}
            className="text-gray-400 hover:text-white p-1"
            aria-label="Clear selection">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
