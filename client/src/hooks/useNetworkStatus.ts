import { useEffect, useCallback, useState } from "react";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";

interface UseNetworkStatusReturn {
  isOnline: boolean;
}

export function useNetworkStatus(): UseNetworkStatusReturn {
  const { logout, isUnlocked } = useVault();
  const { showToast } = useToast();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    if (isUnlocked) {
      showToast(
        "Connection lost. You have been logged out for security.",
        "error"
      );
      logout();
    }
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
