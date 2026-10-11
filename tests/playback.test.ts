import test from "node:test";
import assert from "node:assert/strict";
import { PronunciationPlayer } from "../lib/pronunciation-player.ts";
import type { PlaybackState } from "../lib/pronunciation-player.ts";

function fixture() {
  const states: PlaybackState[] = [];
  const requests: { resolve: () => void; reject: (reason: unknown) => void }[] =
    [];
  let created = 0;
  const audio = {
    src: "",
    currentTime: 5,
    ended: false,
    error: null as Pick<MediaError, "code"> | null,
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
    pause() {},
    load() {
      this.error = null;
    },
    removeAttribute() {
      this.src = "";
    },
    play() {
      return new Promise<void>((resolve, reject) =>
        requests.push({ resolve, reject }),
      );
    },
  };
  const player = new PronunciationPlayer(
    { a: "/audio/ja/a.mp3", b: "/audio/ja/b.mp3" },
    (state) => states.push(state),
    () => {
      created++;
      // This mock implements only the media surface exercised by the player.
      return audio as unknown as HTMLAudioElement;
    },
  );
  return { audio, player, states, requests, created: () => created };
}

test("player lazily reuses one element, restarts clips and reports completion", async () => {
  const f = fixture();
  assert.equal(f.created(), 0);
  f.player.play("a");
  assert.equal(f.audio.src, "/audio/ja/a.mp3");
  assert.equal(f.audio.currentTime, 0);
  assert.deepEqual(f.states.at(-1), { itemId: "a", status: "loading" });
  f.requests[0].resolve();
  await Promise.resolve();
  assert.deepEqual(f.states.at(-1), { itemId: "a", status: "playing" });
  f.audio.currentTime = 3;
  f.player.play("a");
  assert.equal(f.audio.currentTime, 0);
  assert.equal(f.created(), 1);
  f.requests[1].resolve();
  await Promise.resolve();
  f.audio.ended = true;
  assert.ok(f.audio.onended);
  f.audio.onended();
  assert.deepEqual(f.states.at(-1), { itemId: null, status: "idle" });
});

test("switching items and stopping invalidate late promises and old events", async () => {
  const f = fixture();
  f.player.play("a");
  const oldEnded = f.audio.onended;
  assert.ok(oldEnded);
  f.player.play("b");
  f.requests[0].reject(new Error("Old request"));
  f.audio.ended = true;
  oldEnded();
  await Promise.resolve();
  assert.deepEqual(f.states.at(-1), { itemId: "b", status: "loading" });
  f.player.stop();
  f.requests[1].resolve();
  await Promise.resolve();
  assert.equal(f.audio.src, "");
  assert.equal(f.audio.onended, null);
  assert.deepEqual(f.states.at(-1), { itemId: null, status: "idle" });
});

test("autoplay rejection, load errors and absent sources stay recoverable", async () => {
  const f = fixture();
  f.player.play("missing");
  assert.equal(f.created(), 0);
  assert.equal(f.states.at(-1)?.status, "unavailable");
  f.player.play("a");
  f.requests[0].reject(new DOMException("Blocked", "NotAllowedError"));
  await Promise.resolve();
  assert.equal(f.states.at(-1)?.status, "blocked");
  f.player.play("a");
  f.audio.error = { code: 4 };
  assert.ok(f.audio.onerror);
  f.audio.onerror();
  f.requests[1].resolve();
  await Promise.resolve();
  assert.equal(f.states.at(-1)?.status, "unavailable");
  f.player.play("a");
  f.requests[2].reject(new Error("Network"));
  await Promise.resolve();
  assert.equal(f.states.at(-1)?.status, "unavailable");
  f.player.play("a");
  f.requests[3].resolve();
  await Promise.resolve();
  assert.equal(f.states.at(-1)?.status, "playing");
});
