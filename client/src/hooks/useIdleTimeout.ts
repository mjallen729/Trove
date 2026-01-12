import { useEffect, useRef, useState, useCallback } from "react";
import { useVault } from "../context/VaultContext";
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS } from "../types/types";

interface UseIdleTimeoutReturn {
  showWarning: boolean;
  remainingSeconds: number;
  stayLoggedIn: () => void;
}

export function useIdleTimeout(): UseIdleTimeoutReturn {
  const { logout, isUnlocked } = useVault();
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const timerRef = useRef<number | null>(null);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    setRemainingSeconds(0);
  }, []);

  const stayLoggedIn = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!isUnlocked) return;

    // Activity event listeners
    const events = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    const handleActivity = () => {
      // Only reset if warning is not showing
      if (!showWarning) {
        lastActivityRef.current = Date.now();
      }
    };

    events.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Check idle status every second
    timerRef.current = window.setInterval(() => {
      const idleTime = Date.now() - lastActivityRef.current;

      if (idleTime >= IDLE_TIMEOUT_MS) {
        // Auto-logout
        logout();
        setShowWarning(false);
        setRemainingSeconds(0);
      } else if (idleTime >= IDLE_WARNING_MS) {
        // Show warning
        setShowWarning(true);
        const remaining = Math.ceil((IDLE_TIMEOUT_MS - idleTime) / 1000);
        setRemainingSeconds(remaining);
      } else {
        setShowWarning(false);
        setRemainingSeconds(0);
      }
    }, 1000);

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isUnlocked, logout, showWarning]);

  return {
    showWarning,
    remainingSeconds,
    stayLoggedIn,
  };
}
