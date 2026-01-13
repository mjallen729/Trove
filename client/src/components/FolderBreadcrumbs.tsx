import { useMemo } from "react";
import type { ManifestEntry } from "../types/types";
import { getBreadcrumbPath } from "../utils/manifest";

interface FolderBreadcrumbsProps {
  manifest: ManifestEntry[];
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
}

export function FolderBreadcrumbs({
  manifest,
  currentFolderId,
  onNavigate,
}: FolderBreadcrumbsProps) {
  const breadcrumbs = useMemo(
    () => getBreadcrumbPath(manifest, currentFolderId),
    [manifest, currentFolderId]
  );

  return (
    <nav className="flex items-center gap-1 text-sm overflow-x-auto">
      {breadcrumbs.map((crumb, index) => (
        <div
          key={crumb.id ?? "root"}
          className="flex items-center gap-1 flex-shrink-0">
          {index > 0 && (
            <svg
              className="w-4 h-4 text-gray-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          )}
          <button
            onClick={() => onNavigate(crumb.id)}
            className={`
              px-2 py-1 rounded-md transition-colors
              ${
                index === breadcrumbs.length - 1
                  ? "text-white font-medium bg-gray-800"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }
            `}>
            {index === 0 && (
              <svg
                className="w-4 h-4 inline-block mr-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            )}
            {crumb.name}
          </button>
        </div>
      ))}
    </nav>
  );
}
