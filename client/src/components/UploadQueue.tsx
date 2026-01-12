import { useState } from "react";
import type { UploadItem } from "../types/types";

interface UploadQueueProps {
  items: UploadItem[];
  onCancel: (id: string) => void;
  onClearCompleted: () => void;
}

export function UploadQueue({
  items,
  onCancel,
  onClearCompleted,
}: UploadQueueProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (items.length === 0) return null;

  const activeCount = items.filter(
    (i) => i.status === "uploading" || i.status === "pending"
  ).length;
  const completedCount = items.filter((i) => i.status === "completed").length;
  const errorCount = items.filter((i) => i.status === "error").length;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1000;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number | undefined) => {
    if (!bytesPerSecond) return "";
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 bg-gray-800 flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <svg
              className="w-4 h-4 text-cyan-500 animate-spin"
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
          )}
          <span className="font-medium text-white">
            {activeCount > 0
              ? `Uploading ${activeCount} file${activeCount !== 1 ? "s" : ""}`
              : `${completedCount} completed`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(completedCount > 0 || errorCount > 0) && (
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
              isExpanded ? "rotate-180" : ""
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
          {items.map((item) => (
            <UploadQueueItem
              key={item.id}
              item={item}
              onCancel={() => onCancel(item.id)}
              formatBytes={formatBytes}
              formatSpeed={formatSpeed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadQueueItem({
  item,
  onCancel,
  formatBytes,
  formatSpeed,
}: {
  item: UploadItem;
  onCancel: () => void;
  formatBytes: (bytes: number) => string;
  formatSpeed: (bytes: number | undefined) => string;
}) {
  return (
    <div className="px-4 py-3 border-b border-gray-800 last:border-b-0">
      <div className="flex items-center gap-3">
        {/* Status icon */}
        <div className="flex-shrink-0">
          {item.status === "uploading" && (
            <svg
              className="w-5 h-5 text-cyan-500 animate-spin"
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
          )}
          {item.status === "pending" && (
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
          )}
          {item.status === "completed" && (
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
          )}
          {item.status === "error" && (
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
          )}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{item.file.name}</p>
          <p className="text-xs text-gray-500">
            {item.status === "uploading" && (
              <>
                {item.progress}% of {formatBytes(item.file.size)}
                {item.speed && ` - ${formatSpeed(item.speed)}`}
              </>
            )}
            {item.status === "pending" && "Waiting..."}
            {item.status === "completed" && formatBytes(item.file.size)}
            {item.status === "error" && (
              <span className="text-red-400">{item.error || "Failed"}</span>
            )}
          </p>
        </div>

        {/* Cancel button */}
        {(item.status === "uploading" || item.status === "pending") && (
          <button
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-white"
            aria-label="Cancel upload">
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
      {item.status === "uploading" && (
        <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500 transition-all duration-300"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
