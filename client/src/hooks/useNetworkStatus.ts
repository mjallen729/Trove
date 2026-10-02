/**
 * @module hooks/useNetworkStatus
 * @description Hook tracking online/offline status; logs the user out for
 * security when the connection is lost, unless a transfer is running, in
 * which case the transfer pauses itself and resumes when back online.
 */
import { useEffect, useCallback, useState, useRef } from "react";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";

interface UseNetworkStatusReturn {
  isOnline: boolean;
}

export function useNetworkStatus(
  transferActive: boolean
): UseNetworkStatusReturn {
  const { logout, isUnlocked } = useVault();
  const { showToast } = useToast();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const transferActiveRef = useRef(transferActive);
  useEffect(() => {
    transferActiveRef.current = transferActive;
  }, [transferActive]);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    if (!isUnlocked) return;

    if (transferActiveRef.current) {
      showToast(
        "Connection lost. Transfers are paused until it returns.",
        "warning"
      );
      return;
    }

    showToast(
      "Connection lost. You have been logged out for security.",
      "error"
    );
    logout();
  }, [isUnlocked, logout, showToast]);

  const handleOnline = useCallback(() => {
    setIsOnline(true);
  }, []);

  useEffect(() => {
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [handleOffline, handleOnline]);

  return {
    isOnline,
  };
}
