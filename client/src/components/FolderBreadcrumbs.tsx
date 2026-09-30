/**
 * @module components/FolderBreadcrumbs
 * @description Breadcrumb navigation for the current folder path within the vault.
 */
import { useMemo } from "react";
import type { VaultManifest } from "../types/types";
import { getBreadcrumbPath } from "../utils/manifest";

interface FolderBreadcrumbsProps {
  manifest: VaultManifest;
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

  // Nothing to navigate back to at the root
  if (breadcrumbs.length <= 1) return null;

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
            {crumb.name}
          </button>
        </div>
      ))}
    </nav>
  );
}
