import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { items } from "../lib/kana/catalog.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODEL = "eleven_v4";
const LANGUAGE = "ja";
const FORMAT = "mp3_44100_128";
const MAX_ATTEMPTS = 3;
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const QUOTA_ERRORS = new Set([
  "quota_exceeded",
  "insufficient_credits",
  "credit_balance_insufficient",
]);

export class AudioError extends Error {
  constructor(message, fatal = false) {
    super(message);
    this.name = "AudioError";
    this.fatal = fatal;
  }
}

export function parseOptions(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        help: { type: "boolean", short: "h" },
        "dry-run": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        item: { type: "string" },
        limit: { type: "string" },
      },
    }));
  } catch {
    throw new AudioError(
      "Invalid arguments. Use --help to see the supported options.",
    );
  }
  if (
    values.limit !== undefined &&
    (!/^[1-9]\d*$/.test(values.limit) ||
      !Number.isSafeInteger(Number(values.limit)))
  ) {
    throw new AudioError("--limit must be a positive integer.");
  }
  return {
    help: values.help ?? false,
    dryRun: values["dry-run"],
    force: values.force,
    item: values.item,
    limit: values.limit === undefined ? undefined : Number(values.limit),
  };
}

export async function loadConfig(root, environment) {
  let local = {};
  try {
    local = parseEnv(await readFile(join(root, ".env.local"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new AudioError(
        "Could not read .env.local. Check its permissions and format.",
      );
  }
  const value = (key) => environment[key] ?? local[key];
  const apiKey = value("ELEVENLABS_API_KEY")?.trim();
  const voiceId = value("ELEVENLABS_VOICE_ID")?.trim();
  const modelId = value("ELEVENLABS_MODEL_ID")?.trim() || DEFAULT_MODEL;
  if (!apiKey || !voiceId)
    throw new AudioError(
      "Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.local or your environment.",
    );
  if (!/^[a-zA-Z0-9_-]+$/.test(voiceId))
    throw new AudioError(
      "ELEVENLABS_VOICE_ID must be a voice ID, not a name or URL.",
    );
  if (!/^[a-zA-Z0-9_-]+$/.test(modelId))
    throw new AudioError(
      "ELEVENLABS_MODEL_ID must contain only letters, numbers, underscores or hyphens.",
    );
  return {
    apiKey,
    voiceId,
    modelId,
    language: LANGUAGE,
    outputFormat: FORMAT,
  };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function specification(item, config) {
  const entry = {
    id: item.id,
    text: item.glyph,
    reading: item.reading,
    url: `/audio/ja/${item.id}.mp3`,
    voiceId: config.voiceId,
    modelId: config.modelId,
    language: config.language,
    outputFormat: config.outputFormat,
  };
  return { ...entry, fingerprint: digest(JSON.stringify(entry)) };
}

export function isMp3(bytes) {
  if (bytes.length < 10) return false;
  return (
    bytes.subarray(0, 3).toString("ascii") === "ID3" ||
    (bytes[0] === 0xff &&
      (bytes[1] & 0xe0) === 0xe0 &&
      (bytes[1] & 0x18) !== 0x08 &&
      (bytes[1] & 0x06) !== 0 &&
      (bytes[2] & 0xf0) !== 0 &&
      (bytes[2] & 0xf0) !== 0xf0 &&
      (bytes[2] & 0x0c) !== 0x0c)
  );
}

async function optionalRead(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new AudioError(
      "Could not read a local audio file. Check directory permissions.",
      true,
    );
  }
}

async function readManifest(directory) {
  const raw = await optionalRead(join(directory, "manifest.json"));
  if (!raw) return { version: 1, items: {} };
  try {
    const manifest = JSON.parse(raw);
    if (
      manifest?.version !== 1 ||
      !manifest.items ||
      typeof manifest.items !== "object" ||
      Array.isArray(manifest.items)
    )
      throw new Error();
    for (const [id, entry] of Object.entries(manifest.items)) {
      if (
        !/^[a-zA-Z0-9_-]+$/.test(id) ||
        !entry ||
        entry.id !== id ||
        entry.url !== `/audio/ja/${id}.mp3` ||
        ![
          "text",
          "reading",
          "voiceId",
          "modelId",
          "language",
          "outputFormat",
        ].every((key) => typeof entry[key] === "string") ||
        !/^[a-f0-9]{64}$/.test(entry.fingerprint ?? "") ||
        !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "") ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes <= 0
      )
        throw new Error();
    }
    return manifest;
  } catch {
    throw new AudioError(
      "The audio manifest is invalid. Restore it from a backup before generating more audio.",
    );
  }
}

// Rename within one directory: interrupted writes never replace a complete file.
async function atomicWrite(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function retryDelay(header, attempt, now = Date.now()) {
  if (header !== null && header !== undefined) {
    const seconds = Number(header);
    if (header.trim() && Number.isFinite(seconds) && seconds >= 0)
      return seconds * 1000;
    const timestamp = Date.parse(header);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - now);
  }
  return 1000 * 2 ** (attempt - 1);
}

async function synthesize(
  item,
  config,
  { fetchImpl, wait, timeoutMs, log, now },
) {
  const url = `https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${config.outputFormat}`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "xi-api-key": config.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          inputs: [{ text: item.glyph, voice_id: config.voiceId }],
          model_id: config.modelId,
          language_code: config.language,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        let providerStatus;
        try {
          providerStatus = (await response.json())?.detail?.status;
        } catch {
          /* Do not log provider response bodies. */
        }
        if ([401, 403].includes(response.status))
          throw new AudioError(
            `HTTP ${response.status}: authentication or voice access denied. Check your key and voice ID.`,
            true,
          );
        if (response.status === 402 || QUOTA_ERRORS.has(providerStatus))
          throw new AudioError(
            "ElevenLabs credits are unavailable. Check your account before resuming.",
            true,
          );
        if (TRANSIENT.has(response.status) && attempt < MAX_ATTEMPTS) {
          const milliseconds = retryDelay(
            response.headers.get("Retry-After"),
            attempt,
            now(),
          );
          log(
            `  HTTP ${response.status}; retry ${attempt + 1}/${MAX_ATTEMPTS} in ${Math.ceil(milliseconds / 1000)}s.`,
          );
          await wait(milliseconds);
          continue;
        }
        throw new AudioError(
          `HTTP ${response.status}: generation failed${TRANSIENT.has(response.status) ? " after three attempts" : ""}.`,
        );
      }
      const contentType = response.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      if (!["audio/mpeg", "audio/mp3"].includes(contentType))
        throw new AudioError(
          "The response was not MP3 audio; no file was saved.",
        );
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!isMp3(bytes))
        throw new AudioError(
          "The response was empty or lacked an MP3 header; no file was saved.",
        );
      return bytes;
    } catch (error) {
      if (error instanceof AudioError) throw error;
      if (["TimeoutError", "AbortError"].includes(error.name))
        throw new AudioError(
          "Request timed out. The item was not saved; resume after checking your account.",
          true,
        );
      throw new AudioError(
        "Network request failed. The item was not saved; resume after checking your connection.",
        true,
      );
    }
  }
}

function summary(result, log) {
  log(
    `Summary: ${result.generated} generated, ${result.skipped} existing, ${result.failed} failed, ${result.pending} not processed.`,
  );
  return {
    ...result,
    exitCode:
      result.failed > 0 || (!result.dryRun && result.pending > 0) ? 1 : 0,
  };
}

/** Imports are side-effect free. Tests inject temporary directories and a fake API. */
export async function generateAudio({
  options = {},
  root = projectRoot,
  environment = process.env,
  catalog = items,
  fetchImpl = globalThis.fetch,
  wait = /** @type {(ms: number) => Promise<unknown>} */ (delay),
  timeoutMs = 60000,
  now = Date.now,
  log = console.log,
} = {}) {
  if (
    catalog.some((item) => !/^[a-zA-Z0-9_-]+$/.test(item.id)) ||
    new Set(catalog.map((item) => item.id)).size !== catalog.length
  ) {
    throw new AudioError(
      "Catalogue item IDs must be unique and safe filenames.",
    );
  }
  let selected = options.item
    ? catalog.filter((item) => item.id === options.item)
    : catalog;
  if (options.item && !selected.length)
    throw new AudioError(
      "Unknown item ID. Run --dry-run to list available IDs.",
    );
  if (options.limit !== undefined) selected = selected.slice(0, options.limit);
  const result = {
    generated: 0,
    skipped: 0,
    failed: 0,
    pending: selected.length,
    dryRun: !!options.dryRun,
  };
  log(
    `${catalog.length} catalogue items; ${selected.length} selected; ${selected.reduce((count, item) => count + Array.from(item.glyph).length, 0)} Japanese characters of input.`,
  );
  if (options.dryRun) {
    for (const item of selected)
      log(
        `${item.id}: ${item.glyph} (${item.reading}) -> public/audio/ja/${item.id}.mp3`,
      );
    log("Dry run: no API requests or file writes.");
    return summary(result, log);
  }
  const config = await loadConfig(root, environment);
  const directory = join(root, "public", "audio", "ja");
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, ".generation.lock");
  let locked = false;
  try {
    try {
      await writeFile(lockPath, String(process.pid), { flag: "wx" });
      locked = true;
    } catch {
      throw new AudioError(
        "Another generator may be running. If it was interrupted, remove public/audio/ja/.generation.lock before resuming.",
      );
    }
    const manifest = await readManifest(directory);
    const jobs = [];
    for (const item of selected) {
      const spec = specification(item, config);
      const previous = manifest.items[item.id];
      const existing = await optionalRead(join(directory, `${item.id}.mp3`));
      const matches = previous?.fingerprint === spec.fingerprint;
      if (
        !options.force &&
        ((previous && !matches) || (existing?.length && !previous))
      ) {
        result.failed++;
        result.pending--;
        log(
          `${item.id}: existing audio has different or unknown settings. Use --force to replace it.`,
        );
      } else
        jobs.push({
          item,
          spec,
          skip:
            !options.force &&
            matches &&
            existing &&
            isMp3(existing) &&
            existing.length === previous.bytes &&
            digest(existing) === previous.sha256,
        });
    }
    // Detect configuration conflicts before spending credits on any selected item.
    if (result.failed) return summary(result, log);
    for (const [index, job] of jobs.entries()) {
      log(`[${index + 1}/${jobs.length}] ${job.item.id}: ${job.item.glyph}`);
      if (job.skip) {
        result.skipped++;
        result.pending--;
        continue;
      }
      try {
        const audio = await synthesize(job.item, config, {
          fetchImpl,
          wait,
          timeoutMs,
          log,
          now,
        });
        await atomicWrite(join(directory, `${job.item.id}.mp3`), audio);
        const nextManifest = {
          ...manifest,
          items: {
            ...manifest.items,
            [job.item.id]: {
              ...job.spec,
              bytes: audio.length,
              sha256: digest(audio),
            },
          },
        };
        await atomicWrite(
          join(directory, "manifest.json"),
          JSON.stringify(nextManifest, null, 2) + "\n",
        );
        manifest.items = nextManifest.items;
        result.generated++;
        result.pending--;
      } catch (error) {
        result.failed++;
        result.pending--;
        log(
          `${job.item.id}: ${error instanceof AudioError ? error.message : "Could not save generated audio. Check directory permissions."}`,
        );
        if (!(error instanceof AudioError) || error.fatal) break;
      }
    }
  } finally {
    if (locked) await rm(lockPath, { force: true });
  }
  return summary(result, log);
}

const HELP = `Generate local Japanese MP3s from the Nihongo catalogue.

Usage: npm run audio:generate -- [options]
  --dry-run     List selected items without credentials, requests or file writes
  --limit N     Select the first N items (including existing files)
  --item ID     Select a single catalogue item
  --force       Regenerate selected files, including existing valid audio
  --help, -h    Show this help

Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.local or your environment.
Set ELEVENLABS_MODEL_ID to choose a model; the default is eleven_v4.
The model must support the Text to Dialogue endpoint and Japanese language selection.
Output: public/audio/ja/<item-id>.mp3 and manifest.json.
Generation uses ElevenLabs credits. Start with --limit 5 and listen before the full batch.`;

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else process.exitCode = (await generateAudio({ options })).exitCode;
  } catch (error) {
    console.error(
      error instanceof AudioError
        ? error.message
        : "Audio generation stopped because of a local error. Check file permissions and configuration.",
    );
    process.exitCode = 1;
  }
}
