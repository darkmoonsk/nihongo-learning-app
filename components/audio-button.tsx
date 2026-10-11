"use client";

import { IoVolumeHighOutline } from "react-icons/io5";
import { copy } from "@/lib/copy";
import type { KanaItem } from "@/lib/kana/types";
import type { PlaybackState } from "@/lib/pronunciation-player";

export function AudioButton({
  item,
  available,
  state,
  onPlay,
}: {
  item: KanaItem;
  available: boolean;
  state: PlaybackState;
  onPlay: (id: string) => void;
}) {
  const active = state.itemId === item.id;
  const loading = active && state.status === "loading";
  const playing = active && state.status === "playing";
  const message =
    !available || (active && state.status === "unavailable")
      ? copy.audio.unavailable
      : active && state.status === "blocked"
        ? copy.audio.blocked
        : null;
  return (
    <div className="audio-control">
      <button
        type="button"
        className={`audio-button ${playing ? "is-playing" : ""}`}
        aria-label={`${copy.audio.play} ${item.glyph}`}
        aria-busy={loading}
        disabled={!available}
        onClick={() => onPlay(item.id)}
        title={`${copy.audio.play} ${item.glyph}`}
      >
        <IoVolumeHighOutline aria-hidden="true" size={22} />
      </button>
      {message ? (
        <p className="audio-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
