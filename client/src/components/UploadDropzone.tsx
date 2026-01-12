import {
  useCallback,
  useState,
  useRef,
  type DragEvent,
  type ReactNode,
} from "react";

interface UploadDropzoneProps {
  onFilesDropped: (files: File[]) => void;
  children: ReactNode;
  disabled?: boolean;
}

export function UploadDropzone({
  onFilesDropped,
  children,
  disabled = false,
}: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current++;
      if (!disabled && dragCounterRef.current === 1) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
    },
    []
  );

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (disabled) return;

      const files: File[] = [];
      const items = e.dataTransfer.items;

      // Process dropped items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.kind !== "file") continue;

        // Try to get as FileSystemEntry for folder support
        const entry = item.webkitGetAsEntry?.();

        if (entry) {
          const entryFiles = await processEntry(entry);
          files.push(...entryFiles);
        } else {
          // Fallback to simple file
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        onFilesDropped(files);
      }
    },
    [disabled, onFilesDropped]
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative min-h-full ${
        isDragging ? "ring-2 ring-cyan-500 ring-inset" : ""
      }`}>
      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-cyan-500/10 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-gray-900 border border-cyan-500 rounded-xl px-6 py-4 text-center">
            <svg
              className="w-12 h-12 text-cyan-500 mx-auto mb-2"
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
            <p className="text-cyan-400 font-medium">
              Drop files here to upload
            </p>
            <p className="text-gray-500 text-sm">Files and folders supported</p>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Recursively process a FileSystemEntry to get all files
 */
async function processEntry(entry: FileSystemEntry): Promise<File[]> {
  const files: File[] = [];

  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    files.push(file);
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();

    // Read all entries in directory
    let entries: FileSystemEntry[] = [];
    let batch: FileSystemEntry[];

    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      entries = entries.concat(batch);
    } while (batch.length > 0);

    // Process each entry recursively
    for (const childEntry of entries) {
      const childFiles = await processEntry(childEntry);
      files.push(...childFiles);
    }
  }

  return files;
}
