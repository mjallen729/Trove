// Core manifest types for vault file/folder structure
export interface ManifestEntry {
  id: string;
  name: string;
  type: "file" | "folder";
  parent: string | null;
  // File-specific fields
  file_uid?: string;
  size?: number;
  chunk_count?: number;
  mime_type?: string;
  created_at: string;
}

export interface VaultManifest {
  chunk_path_pepper: string;
  entries: ManifestEntry[];
}

// Vault metadata from server
export interface VaultRecord {
  uid: string;
  manifest_cipher: number[];
  created_at: string;
  burn_at: string | null;
  storage_used: number;
  storage_limit: number;
}

// Upload tracking (server-side record)
export interface UploadRecord {
  upload_id: string;
  vault_uid: string;
  file_uid: string;
  file_name_encrypted: number[] | null;
  total_chunks: number;
  received_chunks: number[];
  created_at: string;
}

// Upload queue item (client-side state)
export interface UploadItem {
  id: string;
  file: File;
  file_uid: string;
  parentId: string | null;
  progress: number;
  status: "pending" | "uploading" | "paused" | "completed" | "error";
  error?: string;
  chunksUploaded: number;
  totalChunks: number;
  speed?: number;
  startTime?: number;
}

// Download progress tracking
export interface DownloadProgress {
  fileId: string;
  fileName: string;
  progress: number;
  status: "downloading" | "decrypting" | "completed" | "error";
}

// Burn timer options
export type BurnTimerOption = "24h" | "7d" | "30d" | "90d" | "1y" | "never";

export const BURN_TIMER_LABELS: Record<BurnTimerOption, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  never: "Never",
};

export const BURN_TIMER_OPTIONS: BurnTimerOption[] = [
  "24h",
  "7d",
  "30d",
  "90d",
  "1y",
  "never",
];

// Toast notification types
export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

// Constants
export const CHUNK_SIZE = 10_000_000; // 10MB
export const MAX_CONCURRENT_UPLOADS = 3;
export const MAX_CONCURRENT_CHUNKS = 3;
export const MAX_FILE_NAME_LENGTH = 255;
export const STORAGE_LIMIT_BYTES = 5_000_000_000; // 5GB
export const FREE_STORAGE_BYTES = 5_000_000_000; // 5GB free allocation
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
export const IDLE_WARNING_MS = 13 * 60 * 1000; // 13 minutes

// Storage transaction type
export interface StorageTransact {
  id: string;
  transaction_uid: string;
  vault_uid: string;
  storage_bytes: number;
  previous_transact: string | null;
  created_at: string;
}
