import type { SchemaEntry } from "../types/types";

interface FileRowProps {
  entry: SchemaEntry;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onToggle: () => void;
}

export function FileRow({
  entry,
  isSelected,
  onClick,
  onDoubleClick,
  onToggle,
}: FileRowProps) {
  const formatBytes = (bytes: number | undefined) => {
    if (!bytes) return "—";
    if (bytes === 0) return "0 B";
    const k = 1000;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Today";
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`
        grid grid-cols-12 gap-4 px-4 py-3 rounded-lg cursor-pointer
        transition-colors select-none
        ${isSelected ? "bg-cyan-500/10 ring-1 ring-cyan-500/50" : "hover:bg-gray-900"}
      `}>
      {/* Checkbox */}
      <div className="col-span-1 flex items-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-cyan-500
                     focus:ring-cyan-500 focus:ring-offset-gray-900"
        />
      </div>

      {/* Icon and name */}
      <div className="col-span-6 flex items-center gap-3 min-w-0">
        {entry.type === "folder" ? (
          <svg
            className="w-5 h-5 text-cyan-500 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 24 24">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
          </svg>
        ) : (
          <FileIcon mimeType={entry.mime_type} />
        )}
        <span className="text-white truncate">{entry.name}</span>
      </div>

      {/* Size */}
      <div className="col-span-2 flex items-center text-gray-500 text-sm">
        {entry.type === "file" ? formatBytes(entry.size) : "—"}
      </div>

      {/* Date */}
      <div className="col-span-3 flex items-center text-gray-500 text-sm">
        {formatDate(entry.created_at)}
      </div>
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType?: string }) {
  const type = mimeType || "application/octet-stream";

  // Image files
  if (type.startsWith("image/")) {
    return (
      <svg
        className="w-5 h-5 text-purple-400 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    );
  }

  // Video files
  if (type.startsWith("video/")) {
    return (
      <svg
        className="w-5 h-5 text-pink-400 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
    );
  }

  // Audio files
  if (type.startsWith("audio/")) {
    return (
      <svg
        className="w-5 h-5 text-green-400 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
        />
      </svg>
    );
  }

  // PDF
  if (type === "application/pdf") {
    return (
      <svg
        className="w-5 h-5 text-red-400 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
    );
  }

  // Text/document files
  if (
    type.startsWith("text/") ||
    type.includes("document") ||
    type.includes("word")
  ) {
    return (
      <svg
        className="w-5 h-5 text-blue-400 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    );
  }

  // Archive files
  if (
    type.includes("zip") ||
    type.includes("rar") ||
    type.includes("tar") ||
    type.includes("archive")
  ) {
    return (
      <svg
        className="w-5 h-5 text-yellow-400 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
        />
      </svg>
    );
  }

  // Default file icon
  return (
    <svg
      className="w-5 h-5 text-gray-400 flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}
