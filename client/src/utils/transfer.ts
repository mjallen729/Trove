/**
 * @module utils/transfer
 * @description Shared plumbing for long-running transfers — a vault-wide
 * abort signal, offline gating, retry with backoff, Supabase error
 * classification, batched chunk removal, and the in-memory download cap.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_REMOVE_BATCH } from "../types/types";
import { STORAGE_BUCKET } from "./supabase";
import { transferLogger } from "./logger";

// Retry delays after each failed attempt (6 retries, 7 attempts total)
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

// One controller per unlocked vault. Logout aborts it before the key is wiped
// so no worker can encrypt or upload with a zeroed key.
let controller = new AbortController();

export function getTransferSignal(): AbortSignal {
  return controller.signal;
}

export function abortTransfers(): void {
  controller.abort();
}

export function resetTransfers(): void {
  if (controller.signal.aborted) {
    controller = new AbortController();
  }
}

export function abortError(): DOMException {
  return new DOMException("Transfer aborted", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "AbortError"
  );
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/**
 * Combine the vault-wide signal with a per-transfer one
 */
export function linkedSignal(local: AbortSignal): AbortSignal {
  return AbortSignal.any([controller.signal, local]);
}

/**
 * Resolve once the browser reports being online (immediately if it already is)
 */
export function waitForOnline(signal: AbortSignal): Promise<void> {
  if (navigator.onLine) return Promise.resolve();
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("online", onOnline);
      signal.removeEventListener("abort", onAbort);
    };
    const onOnline = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    window.addEventListener("online", onOnline);
    signal.addEventListener("abort", onAbort);
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort);
  });
}

/**
 * Errors that no amount of retrying will fix: aborted, or the session was
 * rejected (Postgres 42501 from RLS/RPC, HTTP 401/403 from storage).
 */
export function isNonRetryableError(err: unknown): boolean {
  if (isAbortError(err)) return true;
  if (typeof err !== "object" || err === null) return false;
  const { code, statusCode, status } = err as {
    code?: string;
    statusCode?: string | number;
    status?: number;
  };
  if (code === "42501") return true;
  const http = String(statusCode ?? status ?? "");
  return http === "401" || http === "403";
}

/**
 * Storage "object already exists" (upload with upsert: false hit an object
 * stored by an earlier attempt whose response was lost)
 */
export function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { statusCode, status, message } = err as {
    statusCode?: string | number;
    status?: number;
    message?: string;
  };
  const http = String(statusCode ?? status ?? "");
  return http === "409" || /already exists/i.test(message ?? "");
}

interface RetryOptions {
  signal: AbortSignal;
  // Called with true while gated on the connection coming back, false after
  onWait?: (waiting: boolean) => void;
  onRetry?: (attempt: number, err: unknown) => void;
}

/**
 * Run `fn` with exponential backoff. Before every attempt, wait for the
 * browser to be online. Never retries aborts or session rejections.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { signal, onWait, onRetry }: RetryOptions
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (!navigator.onLine) {
      onWait?.(true);
      try {
        await waitForOnline(signal);
      } finally {
        onWait?.(false);
      }
    }
    throwIfAborted(signal);

    try {
      return await fn();
    } catch (err) {
      if (isNonRetryableError(err) || attempt >= RETRY_DELAYS_MS.length) {
        throw err;
      }
      onRetry?.(attempt + 1, err);
      await delay(RETRY_DELAYS_MS[attempt], signal);
    }
  }
}

/**
 * Remove chunk objects in batches of STORAGE_REMOVE_BATCH (the API cap).
 * Missing objects are ignored by storage, so a partial retry is safe.
 */
export async function removeChunkPaths(
  client: SupabaseClient,
  paths: string[]
): Promise<{ failed: number }> {
  let failed = 0;

  for (let i = 0; i < paths.length; i += STORAGE_REMOVE_BATCH) {
    const batch = paths.slice(i, i + STORAGE_REMOVE_BATCH);
    const { error } = await client.storage.from(STORAGE_BUCKET).remove(batch);

    if (error) {
      failed++;
      transferLogger.error("Chunk remove batch failed:", {
        message: error.message,
        name: error.name,
        offset: i,
        count: batch.length,
      });
    }
  }

  return { failed };
}

/**
 * Largest file the in-memory download path will accept: 1 GiB per GiB of
 * reported device memory (Firefox and Safari hide it, so they get 1 GiB).
 */
export function memoryDownloadLimit(): number {
  const gib = navigator.deviceMemory ?? 1;
  return gib * 1024 * 1024 * 1024;
}
