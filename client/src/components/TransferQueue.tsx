/**
 * @module components/TransferQueue
 * @description Floating panel showing per-file upload and download progress
 * and status, with cancel, retry, and clear-completed controls.
 */
import { useState } from "react";
import type { UploadItem, DownloadProgress } from "../types/types";

interface TransferQueueProps {
  uploads: UploadItem[];
  downloads: DownloadProgress[];
  onCancelUpload: (id: string) => void;
  onRetryUpload: (id: string) => void;
  onCancelDownload: (id: string) => void;
  onClearCompleted: () => void;
}

type RowStatus =
  "pending" | "active" | "paused" | "completed" | "error" | "cancelled";

interface TransferRowData {
  id: string;
  name: string;
  size: number;
  progress: number;
  speed?: number;
  status: RowStatus;
  error?: string;
  direction: "upload" | "download";
  onCancel: () => void;
  onRetry?: () => void;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1000;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1
  );
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const formatSpeed = (bytesPerSecond: number | undefined) => {
  if (!bytesPerSecond) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
};

export function TransferQueue({
  uploads,
  downloads,
  onCancelUpload,
  onRetryUpload,
  onCancelDownload,
  onClearCompleted,
}: TransferQueueProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const rows: TransferRowData[] = [
    ...uploads.map<TransferRowData>((u) => ({
      id: u.id,
      name: u.file.name,
      size: u.file.size,
      progress: u.progress,
      speed: u.speed,
      status:
        u.status === "uploading"
          ? "active"
          : u.status === "paused"
            ? "paused"
            : u.status,
      error: u.error,
      direction: "upload",
      onCancel: () => onCancelUpload(u.id),
      onRetry: u.canRetry ? () => onRetryUpload(u.id) : undefined,
    })),
    ...downloads.map<TransferRowData>((d) => ({
      id: d.id,
      name: d.fileName,
      size: d.size,
      progress: d.progress,
      speed: d.speed,
      status: d.status === "downloading" ? "active" : d.status,
      error: d.error,
      direction: "download",
      onCancel: () => onCancelDownload(d.id),
    })),
  ];

  if (rows.length === 0) return null;

  const isLive = (s: RowStatus) =>
    s === "active" || s === "pending" || s === "paused";
  const activeUploads = rows.filter(
    (r) => r.direction === "upload" && isLive(r.status)
  ).length;
  const activeDownloads = rows.filter(
    (r) => r.direction === "download" && isLive(r.status)
  ).length;
  const activeCount = activeUploads + activeDownloads;
  const finishedCount = rows.length - activeCount;

  const headerText =
    activeCount > 0
      ? [
          activeUploads > 0 &&
            `Uploading ${activeUploads} file${activeUploads !== 1 ? "s" : ""}`,
          activeDownloads > 0 &&
            `Downloading ${activeDownloads} file${activeDownloads !== 1 ? "s" : ""}`,
        ]
          .filter(Boolean)
          .join(", ")
      : `${finishedCount} finished`;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 bg-gray-800 flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          {activeCount > 0 && <Spinner className="w-4 h-4 text-cyan-500" />}
          <span className="font-medium text-white">{headerText}</span>
        </div>
        <div className="flex items-center gap-2">
          {finishedCount > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearCompleted();
              }}
              className="text-xs text-gray-400 hover:text-white">
              Clear
            </button>
          )}
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${
              isExpanded ? "" : "rotate-180"
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {/* Item list */}
      {isExpanded && (
        <div className="max-h-64 overflow-y-auto">
          {rows.map((row) => (
            <TransferRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function Spinner({ className }: { className: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      fill="none"
      viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function StatusIcon({ status }: { status: RowStatus }) {
  switch (status) {
    case "active":
      return <Spinner className="w-5 h-5 text-cyan-500" />;
    case "pending":
    case "paused":
      return (
        <svg
          className="w-5 h-5 text-gray-500"
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
      );
    case "completed":
      return (
        <svg
          className="w-5 h-5 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      );
    case "error":
      return (
        <svg
          className="w-5 h-5 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case "cancelled":
      return (
        <svg
          className="w-5 h-5 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
      );
  }
}

function TransferRow({ row }: { row: TransferRowData }) {
  const verb = row.direction === "upload" ? "Upload" : "Download";

  return (
    <div className="px-4 py-3 border-b border-gray-800 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <StatusIcon status={row.status} />
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">
            <span className="text-gray-500">
              {row.direction === "upload" ? "↑ " : "↓ "}
            </span>
            {row.name}
          </p>
          <p className="text-xs text-gray-500">
            {row.status === "active" && (
              <>
                {row.progress}% of {formatBytes(row.size)}
                {row.speed ? ` - ${formatSpeed(row.speed)}` : ""}
              </>
            )}
            {row.status === "pending" && "Waiting..."}
            {row.status === "paused" && "Waiting for connection..."}
            {row.status === "completed" && formatBytes(row.size)}
            {row.status === "cancelled" && "Cancelled"}
            {row.status === "error" && (
              <span className="text-red-400">{row.error || "Failed"}</span>
            )}
          </p>
        </div>

        {/* Retry (errored upload that kept its chunks) */}
        {row.status === "error" && row.onRetry && (
          <button
            onClick={row.onRetry}
            className="text-xs text-cyan-400 hover:text-cyan-300"
            aria-label={`Retry ${verb.toLowerCase()}`}>
            Retry
          </button>
        )}

        {/* Cancel (running) or discard (errored upload with kept chunks) */}
        {(row.status === "active" ||
          row.status === "pending" ||
          row.status === "paused" ||
          (row.status === "error" && row.onRetry)) && (
          <button
            onClick={row.onCancel}
            className="p-1 text-gray-400 hover:text-white"
            aria-label={
              row.status === "error"
                ? `Discard ${verb.toLowerCase()}`
                : `Cancel ${verb.toLowerCase()}`
            }>
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
        )}
      </div>

      {/* Progress bar */}
      {(row.status === "active" || row.status === "paused") && (
        <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              row.status === "paused" ? "bg-gray-500" : "bg-cyan-500"
            }`}
            style={{ width: `${row.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
