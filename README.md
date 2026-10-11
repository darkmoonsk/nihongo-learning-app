# Nihongo

A friendly, English-first Japanese reading app built with Next.js 16.4, React 19.3, TypeScript and Tailwind CSS 4.

## Run locally

Use **Node.js 24.19 or newer** (see `.nvmrc`, pinned to the project's current Node 26.11.1). Development, production builds and browser tests were validated with Node 24.19 and 26.11.1. The Next.js scripts invoke the Node CLI directly to avoid a Windows executable-shim failure in Turbopack's CSS worker.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No database, account, API key or environment variables are required. Fonts are self-hosted, so builds do not download from Google Fonts.

## Learning experience

Pronunciation audio plays automatically once for each new practice or review question. Use the sound button to replay it, or to hear any item in lessons, the kana chart and result mistakes. Only one clip plays at a time. Browser autoplay restrictions show a manual-play hint; missing or failed audio does not interrupt studying. Audio is served locally from the generated files, with no ElevenLabs request at runtime.

- Two freely accessible tracks: 27 hiragana groups and 34 katakana groups.
- 46 basic characters in each alphabet, voiced forms, contracted sounds and common borrowed-word combinations.
- Contextual word lessons for small tsu and long vowels, using Hepburn romaji.
- Ten-question multiple-choice sessions, immediate feedback, best scores and a mistake-review queue.
- Searchable kana chart, keyboard navigation and reduced-motion support.

Progress is versioned and stored in this browser under `nihongo:progress:v1`. Completing a session marks its group complete regardless of score. A correct answer during mistake review removes the item from the queue. Invalid stored data is recovered safely; blocked storage falls back to session-only progress. Reloading restarts an unfinished quiz while retaining recorded answers in the progress totals and mistake queue.

## Structure

- `app`: server page, layout, local fonts and visual styles.
- `components`: interactive study experience.
- `lib/kana`: typed catalogue, question generation, scoring and persistence.
- `lib/copy.ts`: shared English interface copy, separate from learning content.
- `lib/use-progress.ts`: client-side storage initialization and updates.
- `tests`: catalogue/engine/storage tests and browser journeys.

New content uses stable group/item IDs. Keep existing IDs when changing content so saved progress remains valid. Add future vocabulary or kanji modules through separate catalogues and extend the local Japanese font subset when introducing new kanji. There are no public backend APIs.

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

Unit tests use Node's built-in test runner and TypeScript support. Browser tests use an installed **Google Chrome**, test desktop and mobile viewports, and start a temporary server on port 3100 using the test runner's Node executable. Screenshots are written under `test-results/`; failure traces are retained there as well.

## Generate Japanese audio once

The manual generator reads all 245 current catalogue items and saves a separate MP3 for each item. It uses the model set in `ELEVENLABS_MODEL_ID` (default: **Eleven v4**), Japanese (`ja`), and `mp3_44100_128`. The voice is selected through your ElevenLabs account; choose a voice trained in Japanese. This script does not add playback controls or require an ElevenLabs connection at application runtime.

Add these values to `.env.local` in the project root, using `.env.example` as a reference:

```dotenv
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=your_japanese_voice_id
ELEVENLABS_MODEL_ID=eleven_v4
```

`ELEVENLABS_MODEL_ID` selects the model and defaults to `eleven_v4` when omitted. Choose a model supported by the [Text to Dialogue API](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert) and Japanese language selection. Environment variables take precedence over `.env.local`. Never prefix the key with `NEXT_PUBLIC_`. `.env.local` is ignored by Git; `.env.example` is safe to commit. The script does not print the API key or include it in generated metadata.

```sh
# Inspect all items without credentials, API calls or file writes
npm run audio:generate -- --dry-run

# Generate a small paid sample, then listen to the files locally
npm run audio:generate -- --limit 5

# Generate the remaining items; valid sample files are skipped
npm run audio:generate

# Regenerate only a selected item after reviewing its pronunciation
npm run audio:generate -- --item hiragana-basic-vowels-0 --force

# See all options
npm run audio:generate -- --help
```

Actual generation uses your ElevenLabs credits. Requests go to the [Text to Dialogue API](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert), using one `inputs` entry containing the item's Japanese `glyph` and your voice ID, with the selected `model_id` and `language_code: ja`. Romaji is metadata only and is never sent for pronunciation. Model support is documented in the [ElevenLabs model reference](https://elevenlabs.io/docs/overview/models).

Outputs are stored in `public/audio/ja/<item-id>.mp3` and `public/audio/ja/manifest.json`. Each manifest entry includes its item ID, Japanese text, romaji, public URL, voice/model/language/format, generation fingerprint, byte count and audio checksum. These files can be committed with the app; keep catalogue IDs stable. No audio files are created during installation, builds, tests or `--dry-run`.

The generator runs sequentially and updates the manifest after each completed file. Restarting skips files whose configuration, MP3 header and checksum match. Missing, empty or damaged files with matching metadata are regenerated. Different text, voice or model settings, and existing audio without metadata, require explicit `--force`; configuration conflicts are detected before any generation request. `--force` replaces every selected item, so combine it with `--item` or `--limit` when reviewing individual clips. `--limit` counts the first N selected catalogue items, including existing files.

Each request has a 60-second timeout. Transient HTTP responses (429, 500, 502, 503, 504) receive at most three total attempts, respecting `Retry-After`. Authentication, voice-access and credit errors stop the batch. A timeout or network failure also stops without automatically retrying a request that might already have consumed credits. Other item-level API failures are reported and the batch continues; any failure or unprocessed item produces a nonzero exit code. Audio and manifest writes use temporary files and atomic renames. The previous successful outputs remain available if a later item fails.

Only one generator can run at a time. If the process is forcibly interrupted, confirm that it has stopped and remove `public/audio/ja/.generation.lock` before resuming. If an interruption leaves a completed MP3 without a matching manifest entry, review it and regenerate that item explicitly with `--force`. Restore a malformed manifest from backup instead of overwriting it blindly.

Listen to the sample before generating the full batch, and review short or ambiguous sounds such as を/ヲ, ん/ン, じ/ぢ, ず/づ and foreign combinations. Automated checks validate the audio container and integrity, not pronunciation. Small っ/ッ and long-vowel ー are covered by the existing contextual word examples, not standalone audio clips. You can open the generated files with a local audio player or the app's local server at the URL recorded in the manifest.

Tests simulate the API and use temporary directories. They never send requests to ElevenLabs or consume credits.
