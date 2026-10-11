export type AudioSources = Partial<Record<string, string>>;
export interface PlaybackState {
  itemId: string | null;
  status: "idle" | "loading" | "playing" | "blocked" | "unavailable";
}

export const idlePlayback: PlaybackState = { itemId: null, status: "idle" };

/** One media element for the whole study experience, created only on interaction. */
export class PronunciationPlayer {
  private audio: HTMLAudioElement | null = null;
  private request = 0;
  private readonly sources: AudioSources;
  private readonly update: (state: PlaybackState) => void;
  private readonly createAudio: () => HTMLAudioElement;

  constructor(
    sources: AudioSources,
    update: (state: PlaybackState) => void,
    createAudio: () => HTMLAudioElement = () => new Audio(),
  ) {
    this.sources = sources;
    this.update = update;
    this.createAudio = createAudio;
  }

  stop = (notify = true) => {
    this.request++;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    if (notify) this.update(idlePlayback);
  };

  play = (itemId: string) => {
    this.stop(false);
    const request = this.request;
    const source = this.sources[itemId];
    if (!source) {
      this.update({ itemId, status: "unavailable" });
      return;
    }
    const audio = (this.audio ??= this.createAudio());
    const isCurrent = () => request === this.request;
    this.update({ itemId, status: "loading" });
    audio.preload = "none";
    audio.src = source;
    audio.currentTime = 0;
    audio.onended = () => {
      if (isCurrent() && audio.ended) this.update(idlePlayback);
    };
    audio.onerror = () => {
      if (isCurrent() && audio.error) {
        // Invalidate a pending play promise before reporting the load error.
        this.request++;
        this.update({ itemId, status: "unavailable" });
      }
    };
    try {
      void audio.play().then(
        () => {
          if (isCurrent()) this.update({ itemId, status: "playing" });
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          this.update({
            itemId,
            status:
              error instanceof Error && error.name === "NotAllowedError"
                ? "blocked"
                : "unavailable",
          });
        },
      );
    } catch {
      if (isCurrent()) this.update({ itemId, status: "unavailable" });
    }
  };
}
