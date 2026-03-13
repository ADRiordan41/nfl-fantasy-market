"use client";

import { useEffect, useRef } from "react";

type AdaptivePollingOptions = {
  activeMs: number;
  hiddenMs: number;
  runImmediately?: boolean;
};

export function useAdaptivePolling(
  callback: () => Promise<void> | void,
  { activeMs, hiddenMs, runImmediately = true }: AdaptivePollingOptions,
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let inFlight = false;

    function currentDelay(): number {
      if (typeof document === "undefined") return activeMs;
      return document.visibilityState === "visible" ? activeMs : hiddenMs;
    }

    function clearTimer() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    function schedule(delay: number) {
      clearTimer();
      if (cancelled) return;
      timeoutId = window.setTimeout(() => {
        void tick();
      }, delay);
    }

    async function tick() {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await callbackRef.current();
      } finally {
        inFlight = false;
        if (!cancelled) schedule(currentDelay());
      }
    }

    function handleVisibilityOrOnline() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        clearTimer();
        void tick();
        return;
      }
      schedule(currentDelay());
    }

    if (runImmediately) {
      void tick();
    } else {
      schedule(currentDelay());
    }

    document.addEventListener("visibilitychange", handleVisibilityOrOnline);
    window.addEventListener("online", handleVisibilityOrOnline);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityOrOnline);
      window.removeEventListener("online", handleVisibilityOrOnline);
    };
  }, [activeMs, hiddenMs, runImmediately]);
}
