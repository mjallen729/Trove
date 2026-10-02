/**
 * @module utils/fileSink
 * @description Where decrypted download bytes go. Chromium streams straight
 * to a user-chosen file on disk; other browsers collect Blob parts in memory
 * up to a device-memory-based cap, then hand the Blob to the browser.
 */
import { saveBlob } from "./chunks";
import { memoryDownloadLimit, isAbortError } from "./transfer";

export interface FileSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export class FileTooLargeError extends Error {
  readonly fileName: string;
  readonly limit: number;

  constructor(fileName: string, limit: number) {
    super(`"${fileName}" is too large to download in this browser`);
    this.name = "FileTooLargeError";
    this.fileName = fileName;
    this.limit = limit;
  }
}

// libsodium returns Uint8Array<ArrayBufferLike>; the DOM sinks want a view
// over a plain ArrayBuffer, which is what every buffer here actually is
const asBufferView = (chunk: Uint8Array) => chunk as Uint8Array<ArrayBuffer>;

/**
 * True when the browser can stream to disk (File System Access API)
 */
export function supportsDiskStreaming(): boolean {
  return (
    typeof window.showSaveFilePicker === "function" &&
    typeof window.showDirectoryPicker === "function"
  );
}

/**
 * Ask the user where to save. One file opens a save dialog; several open a
 * directory picker and create one handle per file, never overwriting.
 * Must be the first await after the click: the picker needs the user
 * activation, which any earlier await consumes.
 * Returns null when the user cancels.
 */
export async function pickSaveTargets(
  names: string[]
): Promise<FileSystemFileHandle[] | null> {
  try {
    if (names.length === 1) {
      const handle = await window.showSaveFilePicker!({
        suggestedName: names[0],
      });
      return [handle];
    }

    const dir = await window.showDirectoryPicker!({ mode: "readwrite" });
    const handles: FileSystemFileHandle[] = [];
    const taken = new Set<string>();

    for (const name of names) {
      const unique = await uniqueNameIn(dir, name, taken);
      taken.add(unique);
      handles.push(await dir.getFileHandle(unique, { create: true }));
    }

    return handles;
  } catch (err) {
    if (isAbortError(err)) return null;
    throw err;
  }
}

async function uniqueNameIn(
  dir: FileSystemDirectoryHandle,
  name: string,
  taken: Set<string>
): Promise<string> {
  const lastDot = name.lastIndexOf(".");
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot) : "";

  let candidate = name;
  for (let n = 1; ; n++) {
    if (!taken.has(candidate) && !(await exists(dir, candidate))) {
      return candidate;
    }
    candidate = `${base} (${n})${ext}`;
  }
}

async function exists(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stream to a file handle from the picker. Chromium writes to a temporary
 * swap file and moves it into place on close; abort discards it.
 */
export async function createDiskSink(
  handle: FileSystemFileHandle
): Promise<FileSink> {
  const writable = await handle.createWritable();

  return {
    write: (chunk) => writable.write(asBufferView(chunk)),
    close: () => writable.close(),
    abort: () => writable.abort(),
  };
}

/**
 * Collect Blob parts in memory, then trigger a classic download.
 * Throws FileTooLargeError up front when the file exceeds the cap.
 */
export function createMemorySink(
  name: string,
  mimeType: string,
  size: number
): FileSink {
  const limit = memoryDownloadLimit();
  if (size > limit) {
    throw new FileTooLargeError(name, limit);
  }

  let parts: Blob[] | null = [];

  return {
    write: async (chunk) => {
      // One Blob per chunk lets the browser page parts out of the JS heap
      parts?.push(new Blob([asBufferView(chunk)]));
    },
    close: async () => {
      if (!parts) return;
      saveBlob(new Blob(parts, { type: mimeType }), name);
      parts = null;
    },
    abort: async () => {
      parts = null;
    },
  };
}
