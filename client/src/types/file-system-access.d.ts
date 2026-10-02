/**
 * @module types/file-system-access
 * @description Ambient declarations for the File System Access picker APIs
 * (Chromium only) and `navigator.deviceMemory`; neither is in lib.dom yet.
 */

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface DirectoryPickerOptions {
  mode?: "read" | "readwrite";
  startIn?: string;
}

interface Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions
  ) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (
    options?: DirectoryPickerOptions
  ) => Promise<FileSystemDirectoryHandle>;
}

interface Navigator {
  readonly deviceMemory?: number;
}
