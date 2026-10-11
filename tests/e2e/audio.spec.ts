import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    audioTest: {
      calls: string[];
      pauses: number;
      blocked: boolean;
      element?: HTMLMediaElement;
    };
  }
}

async function mockAudio(page: Page, blocked = false) {
  await page.addInitScript((blocked) => {
    window.audioTest = { calls: [], pauses: 0, blocked };
    HTMLMediaElement.prototype.play = function () {
      window.audioTest.element = this;
      window.audioTest.calls.push(this.getAttribute("src") ?? "");
      return window.audioTest.blocked
        ? Promise.reject(new DOMException("Blocked", "NotAllowedError"))
        : Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      window.audioTest.pauses++;
    };
  }, blocked);
}

async function openLesson(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue learning", exact: true })
    .click();
}

test("manual lists and one autoplay per question, including feedback and navigation", async ({
  page,
}) => {
  await mockAudio(page);
  await openLesson(page);
  const sounds = page.getByRole("button", { name: /^Play pronunciation for/ });
  await expect(sounds).toHaveCount(5);
  await expect(sounds.first()).toHaveCSS("width", "44px");
  await expect(sounds.first()).toHaveCSS("height", "44px");
  expect(await page.evaluate(() => window.audioTest.calls.length)).toBe(0);
  await sounds.first().click();
  await sounds.first().click();
  expect(await page.evaluate(() => window.audioTest.calls.length)).toBe(2);
  await page.getByRole("button", { name: "Let’s practice" }).click();
  expect(await page.evaluate(() => window.audioTest.calls.length)).toBe(3);
  const glyph = await page.locator(".question-glyph").textContent();
  await expect(sounds).toHaveAttribute(
    "aria-label",
    `Play pronunciation for ${glyph}`,
  );
  await page.locator(".answer-button").first().click();
  expect(await page.evaluate(() => window.audioTest.calls.length)).toBe(3);
  await sounds.click();
  expect(await page.evaluate(() => window.audioTest.calls.length)).toBe(4);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  expect(await page.evaluate(() => window.audioTest.calls.length)).toBe(5);
  await page.getByRole("button", { name: "Kana chart", exact: true }).click();
  expect(
    await page.evaluate(() => window.audioTest.element?.getAttribute("src")),
  ).toBeNull();
  expect(await page.evaluate(() => window.audioTest.calls.length)).toBe(5);
  await sounds.first().click();
  await page.getByLabel("Find a character or sound").fill("ka");
  expect(
    await page.evaluate(() => window.audioTest.element?.getAttribute("src")),
  ).toBeNull();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("blocked autoplay offers manual recovery and hidden tabs stop playback", async ({
  page,
}) => {
  await mockAudio(page, true);
  await openLesson(page);
  await page.getByRole("button", { name: "Let’s practice" }).click();
  await expect(page.getByRole("status")).toContainText("Tap the sound button");
  await page.evaluate(() => {
    window.audioTest.blocked = false;
  });
  await page.getByRole("button", { name: /^Play pronunciation for/ }).click();
  await expect(page.locator(".audio-button.is-playing")).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".audio-button.is-playing")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.audioTest.element?.getAttribute("src")),
  ).toBeNull();
});

test("missing audio reports an error without preventing answers", async ({
  page,
}) => {
  await page.route("**/audio/ja/*.mp3", (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
  await openLesson(page);
  await page.getByRole("button", { name: "Let’s practice" }).click();
  await expect(page.getByRole("status")).toContainText("Audio unavailable");
  await page.locator(".answer-button").first().click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
});

test("a generated local MP3 loads and plays in the browser", async ({
  page,
}) => {
  await openLesson(page);
  const loaded = page.waitForResponse((response) =>
    response.url().endsWith("hiragana-basic-vowels-0.mp3"),
  );
  await page
    .getByRole("button", { name: "Play pronunciation for あ", exact: true })
    .click();
  expect((await loaded).ok()).toBe(true);
  await expect(page.locator(".audio-button.is-playing")).toHaveCount(1);
  await expect(
    page.getByText("Audio unavailable", { exact: true }),
  ).toHaveCount(0);
});
