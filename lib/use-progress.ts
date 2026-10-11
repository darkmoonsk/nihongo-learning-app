"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyProgress, loadProgress, saveProgress } from "./kana/progress";
import type { LearningProgress } from "./kana/types";

export function useProgress() {
  const [state, setState] = useState(() => ({
    progress: emptyProgress(),
    ready: false,
    available: true,
  }));
  const current = useRef(state.progress);
  useEffect(() => {
    let cancelled = false;
    // Initialize storage after the first hydrated render, never during SSR.
    Promise.resolve().then(() => {
      if (cancelled) return;
      let loaded;
      try {
        loaded = loadProgress(window.localStorage);
      } catch {
        loaded = { progress: emptyProgress(), available: false };
      }
      current.current = loaded.progress;
      setState({ ...loaded, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const update = useCallback(
    (change: (previous: LearningProgress) => LearningProgress) => {
      const progress = change(current.current);
      current.current = progress;
      let available = false;
      try {
        available = saveProgress(window.localStorage, progress);
      } catch {
        /* Keep studying in memory. */
      }
      setState({ progress, ready: true, available });
    },
    [],
  );
  return { ...state, update };
}
