import test from "node:test";
import type { TestContext } from "node:test";
import type { KanaItem } from "../lib/kana/types.ts";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { items } from "../lib/kana/catalog.ts";
import {
  generateAudio,
  loadConfig,
  parseOptions,
  retryDelay,
} from "../scripts/generate-audio.mjs";

const mp3 = Buffer.concat([
  Buffer.from([0xff, 0xfb, 0x90, 0x64]),
  Buffer.alloc(413),
]);
const credentials = {
  ELEVENLABS_API_KEY: "mock-secret-do-not-log",
  ELEVENLABS_VOICE_ID: "JapaneseTestVoice",
};
const audioResponse = () =>
  new Response(mp3, { headers: { "Content-Type": "audio/mpeg" } });

type RunOverrides = Omit<
  Partial<NonNullable<Parameters<typeof generateAudio>[0]>>,
  "environment" | "wait" | "options"
> & {
  environment?: Record<string, string>;
  wait?: (ms: number) => Promise<void>;
  options?: Partial<ReturnType<typeof parseOptions>>;
};

async function fixture(
  t: TestContext,
  catalog: KanaItem[] = items.slice(0, 3),
) {
  const root = await mkdtemp(join(tmpdir(), "nihongo-audio-test-"));
  t.after(async () => {
    // Only delete the exact, newly created temporary test directory.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "nihongo-audio-test-")));
    await rm(root, { recursive: true, force: true });
  });
  const requests: { url: Parameters<typeof fetch>[0]; request: RequestInit }[] =
    [];
  const logs: string[] = [];
  const directory = join(root, "public", "audio", "ja");
  const run = (overrides: RunOverrides = {}) => {
    const { environment = credentials, ...rest } = overrides;
    return generateAudio({
      root,
      catalog,
      environment: { NODE_ENV: "test", ...environment },
      log: (message) => logs.push(message),
      fetchImpl: async (url, request) => {
        assert.ok(request);
        requests.push({ url, request });
        return audioResponse();
      },
      ...rest,
    });
  };
  return {
    root,
    directory,
    requests,
    logs,
    run,
    manifest: async () =>
      JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  };
}

test("dry run covers all catalogue items without credentials, network or writes", async (t) => {
  const f = await fixture(t, items);
  const result = await f.run({ options: { dryRun: true }, environment: {} });
  assert.equal(result.exitCode, 0);
  assert.equal(result.pending, 245);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(await readdir(f.root), []);
  for (const item of items)
    assert.ok(
      f.logs.some((line) =>
        line.includes(`${item.id}: ${item.glyph} (${item.reading})`),
      ),
    );
});

test("full mocked batch produces one Japanese v4 dialogue request and local MP3 per item", async (t) => {
  const f = await fixture(t, items);
  const result = await f.run();
  assert.equal(result.generated, items.length);
  assert.equal(result.exitCode, 0);
  const manifest = await f.manifest();
  assert.equal(manifest.version, 1);
  assert.equal(Object.keys(manifest.items).length, items.length);
  for (const [index, item] of items.entries()) {
    const { url, request } = f.requests[index];
    assert.equal(
      url,
      "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128",
    );
    assert.equal(request.method, "POST");
    assert.equal(
      new Headers(request.headers).get("xi-api-key"),
      credentials.ELEVENLABS_API_KEY,
    );
    assert.equal(request.redirect, "error");
    assert.equal(typeof request.body, "string");
    assert.deepEqual(JSON.parse(request.body as string), {
      inputs: [{ text: item.glyph, voice_id: credentials.ELEVENLABS_VOICE_ID }],
      model_id: "eleven_v4",
      language_code: "ja",
    });
    assert.deepEqual(await readFile(join(f.directory, `${item.id}.mp3`)), mp3);
    assert.equal(manifest.items[item.id].url, `/audio/ja/${item.id}.mp3`);
    assert.equal(manifest.items[item.id].text, item.glyph);
    assert.equal(manifest.items[item.id].reading, item.reading);
    assert.equal(manifest.items[item.id].modelId, "eleven_v4");
    assert.equal(manifest.items[item.id].bytes, mp3.length);
  }
  assert.ok(!JSON.stringify(manifest).includes(credentials.ELEVENLABS_API_KEY));
  assert.ok(!f.logs.join("\n").includes(credentials.ELEVENLABS_API_KEY));
  assert.ok(
    (await readdir(f.directory)).every(
      (file) => !file.endsWith(".tmp") && file !== ".generation.lock",
    ),
  );
});

test("sample limits, item selection, resume and explicit replacement", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.run({ options: parseOptions(["--limit", "1"]) })).generated,
    1,
  );
  const firstFile = await readFile(join(f.directory, `${items[0].id}.mp3`));
  const resumed = await f.run();
  assert.equal(resumed.generated, 2);
  assert.equal(resumed.skipped, 1);
  const calls = f.requests.length;
  assert.equal((await f.run()).skipped, 3);
  assert.equal(f.requests.length, calls);
  assert.equal(
    (await f.run({ options: parseOptions(["--item", items[0].id, "--force"]) }))
      .generated,
    1,
  );
  assert.equal(f.requests.length, calls + 1);
  assert.deepEqual(
    await readFile(join(f.directory, `${items[0].id}.mp3`)),
    firstFile,
  );
  await assert.rejects(
    f.run({ options: parseOptions(["--item", "not-an-item"]) }),
    /Unknown item ID/,
  );
});

test("voice or text changes require force before any API call", async (t) => {
  const f = await fixture(t);
  await f.run();
  const originalManifest = await readFile(join(f.directory, "manifest.json"));
  const calls = f.requests.length;
  const changedVoice = {
    ...credentials,
    ELEVENLABS_VOICE_ID: "OtherJapaneseVoice",
  };
  const conflict = await f.run({ environment: changedVoice });
  assert.equal(conflict.exitCode, 1);
  assert.equal(conflict.failed, 3);
  assert.equal(f.requests.length, calls);
  assert.deepEqual(
    await readFile(join(f.directory, "manifest.json")),
    originalManifest,
  );
  const changedText = await f.run({ catalog: [{ ...items[0], glyph: "い" }] });
  assert.equal(changedText.failed, 1);
  assert.equal(f.requests.length, calls);
  const forced = await f.run({
    environment: changedVoice,
    options: { item: items[0].id, force: true },
  });
  assert.equal(forced.generated, 1);
  assert.equal(
    (await f.manifest()).items[items[0].id].voiceId,
    "OtherJapaneseVoice",
  );
});

test("model changes in existing metadata require explicit regeneration", async (t) => {
  const f = await fixture(t, [items[0]]);
  await f.run();
  const manifest = await f.manifest();
  manifest.items[items[0].id].modelId = "eleven_flash_v2_5";
  manifest.items[items[0].id].fingerprint = "0".repeat(64);
  await writeFile(join(f.directory, "manifest.json"), JSON.stringify(manifest));
  assert.equal((await f.run()).failed, 1);
  assert.equal(f.requests.length, 1);
  assert.equal((await f.run({ options: { force: true } })).generated, 1);
});

test("zero-byte, missing and corrupted files are repaired while orphaned audio needs force", async (t) => {
  const f = await fixture(t);
  await f.run();
  await writeFile(join(f.directory, `${items[0].id}.mp3`), "");
  await rm(join(f.directory, `${items[1].id}.mp3`));
  await writeFile(join(f.directory, `${items[2].id}.mp3`), "invalid");
  assert.equal((await f.run()).generated, 3);
  await rm(join(f.directory, "manifest.json"));
  const calls = f.requests.length;
  assert.equal((await f.run()).failed, 3);
  assert.equal(f.requests.length, calls);
});

test("environment values override .env.local and configuration does not leak credentials", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.root, ".env.local"),
    'ELEVENLABS_API_KEY="local-secret"\nELEVENLABS_VOICE_ID="LocalVoice"\n',
  );
  assert.equal((await loadConfig(f.root, {})).apiKey, "local-secret");
  assert.equal(
    (await loadConfig(f.root, credentials)).voiceId,
    credentials.ELEVENLABS_VOICE_ID,
  );
  await f.run({ options: { limit: 1 } });
  assert.equal(
    new Headers(f.requests[0].request.headers).get("xi-api-key"),
    credentials.ELEVENLABS_API_KEY,
  );
  await assert.rejects(
    loadConfig(f.root, { ELEVENLABS_API_KEY: "" }),
    /Set ELEVENLABS/,
  );
  await assert.rejects(
    loadConfig(f.root, {
      ...credentials,
      ELEVENLABS_VOICE_ID: "https://invalid/",
    }),
    /voice ID/,
  );
});

test("argument errors and missing credentials fail before requests or writes", async (t) => {
  for (const args of [
    ["--limit", "0"],
    ["--limit", "-1"],
    ["--limit", "1.5"],
    ["--limit", "NaN"],
    ["--limit", "9007199254740992"],
    ["--unknown"],
    ["extra"],
  ])
    assert.throws(() => parseOptions(args));
  assert.equal(parseOptions(["--help"]).help, true);
  const f = await fixture(t);
  await assert.rejects(f.run({ environment: {} }), /Set ELEVENLABS/);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(await readdir(f.root), []);
  await assert.rejects(
    f.run({ catalog: [{ ...items[0], id: "../outside" }] }),
    /safe filenames/,
  );
});

test("transient HTTP responses respect Retry-After with at most three attempts", async (t) => {
  const f = await fixture(t, [items[0]]);
  let calls = 0;
  const waits: number[] = [];
  const result = await f.run({
    wait: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response("{}", { status: 429, headers: { "Retry-After": "2" } })
        : calls === 2
          ? new Response("{}", { status: 503 })
          : audioResponse();
    },
  });
  assert.equal(result.generated, 1);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(
    retryDelay(
      "Sun, 11 Oct 2026 12:00:05 GMT",
      1,
      Date.parse("2026-10-11T12:00:00Z"),
    ),
    5000,
  );
  assert.equal(retryDelay("bad", 2), 2000);
  let exhausted = 0;
  const failed = await f.run({
    options: { force: true },
    wait: async () => {},
    fetchImpl: async () => {
      exhausted++;
      return new Response("{}", { status: 502 });
    },
  });
  assert.equal(exhausted, 3);
  assert.equal(failed.failed, 1);
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(
    await readFile(join(f.directory, `${items[0].id}.mp3`)),
    mp3,
  );
});

test("authentication and quota errors stop the batch and preserve completed work", async (t) => {
  for (const response of [
    () => new Response("{}", { status: 401 }),
    () => new Response("{}", { status: 403 }),
    () => new Response("{}", { status: 402 }),
    () =>
      Response.json({ detail: { status: "quota_exceeded" } }, { status: 429 }),
  ]) {
    const f = await fixture(t);
    let calls = 0;
    const result = await f.run({
      fetchImpl: async () => (++calls === 1 ? audioResponse() : response()),
    });
    assert.equal(calls, 2);
    assert.equal(result.generated, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.pending, 1);
    assert.equal(result.exitCode, 1);
    assert.equal(Object.keys((await f.manifest()).items).length, 1);
    assert.ok(!(await readdir(f.directory)).includes(".generation.lock"));
    const resumed = await f.run();
    assert.equal(resumed.skipped, 1);
    assert.equal(resumed.generated, 2);
  }
});

test("empty, JSON and non-MP3 responses are not saved and failures do not leak secrets", async (t) => {
  for (const response of [
    () => new Response(null, { headers: { "Content-Type": "audio/mpeg" } }),
    () => Response.json({ message: credentials.ELEVENLABS_API_KEY }),
    () =>
      new Response("not audio", { headers: { "Content-Type": "audio/mpeg" } }),
    () => new Response(credentials.ELEVENLABS_API_KEY, { status: 422 }),
  ]) {
    const f = await fixture(t, [items[0]]);
    const result = await f.run({ fetchImpl: async () => response() });
    assert.equal(result.failed, 1);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await readdir(f.directory), []);
    assert.ok(!f.logs.join("\n").includes(credentials.ELEVENLABS_API_KEY));
  }
});

test("timeouts and network errors stop without blindly retrying an uncertain generation", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const timeout = await f.run({
    timeoutMs: 15,
    fetchImpl: async (_url, request) => {
      const signal = request?.signal;
      assert.ok(signal);
      calls++;
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("mock response delayed")),
          100,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(timeout.failed, 1);
  assert.equal(timeout.pending, 2);
  assert.ok(f.logs.some((line) => line.includes("timed out")));
  const network = await f.run({
    fetchImpl: async () => {
      throw new Error(credentials.ELEVENLABS_API_KEY);
    },
  });
  assert.equal(network.failed, 1);
  assert.equal(network.pending, 2);
  assert.ok(!f.logs.join("\n").includes(credentials.ELEVENLABS_API_KEY));
});

test("invalid manifests fail safely without overwriting audio or requesting generation", async (t) => {
  const f = await fixture(t);
  await mkdir(f.directory, { recursive: true });
  await writeFile(join(f.directory, "manifest.json"), "{bad");
  await writeFile(join(f.directory, `${items[0].id}.mp3`), mp3);
  await assert.rejects(f.run(), /manifest is invalid/);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(
    await readFile(join(f.directory, `${items[0].id}.mp3`)),
    mp3,
  );
  assert.ok(!(await readdir(f.directory)).includes(".generation.lock"));
});

test("an interrupted audio write cleans temporary files and preserves earlier successes", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const result = await f.run({
    fetchImpl: async () => {
      calls++;
      if (calls === 2) await mkdir(join(f.directory, `${items[1].id}.mp3`));
      return audioResponse();
    },
  });
  assert.equal(result.generated, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  assert.equal(Object.keys((await f.manifest()).items).length, 1);
  assert.ok(
    (await readdir(f.directory)).every(
      (file) => !file.endsWith(".tmp") && file !== ".generation.lock",
    ),
  );
});

test("two generators cannot charge for the same stale job list", async (t) => {
  const f = await fixture(t, [items[0]]);
  let release!: () => void;
  let notify!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const first = f.run({
    fetchImpl: async () => {
      notify();
      await gate;
      return audioResponse();
    },
  });
  await entered;
  try {
    await assert.rejects(f.run(), /Another generator/);
    assert.equal(
      await readFile(join(f.directory, ".generation.lock"), "utf8"),
      String(process.pid),
    );
  } finally {
    release();
  }
  assert.equal((await first).generated, 1);
  assert.equal(f.requests.length, 0);
});
