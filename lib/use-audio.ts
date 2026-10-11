"use client";

import { useEffect, useState } from "react";
import {
  idlePlayback,
  PronunciationPlayer,
  type AudioSources,
  type PlaybackState,
} from "./pronunciation-player";

export function useAudio(sources: AudioSources) {
  const [state, setState] = useState<PlaybackState>(idlePlayback);
  const [player] = useState(() => new PronunciationPlayer(sources, setState));

  useEffect(() => {
    const hide = () => {
      if (document.hidden) player.stop();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      player.stop(false);
    };
  }, [player]);

  return { state, play: player.play, stop: player.stop };
}
