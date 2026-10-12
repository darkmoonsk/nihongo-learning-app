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

test("audio is available only in the lesson presentation", async ({ page }) => {
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
  await expect(sounds).toHaveCount(0);
  expect(
    await page.evaluate(() => window.audioTest.element?.getAttribute("src")),
  ).toBeNull();
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2030-01-02T00:00:00Z"));
  for (let index = 0; index < 10; index++) {
    await page.locator(".answer-button").first().click();
    await expect(page.locator(".answer-feedback")).toBeVisible();
    await page.clock.runFor(2000);
  }
  await expect(page.locator(".result-page")).toBeVisible();
  await expect(sounds).toHaveCount(0);
  await page.getByRole("button", { name: "Kana chart", exact: true }).click();
  await expect(sounds).toHaveCount(0);
  expect(await page.evaluate(() => window.audioTest.calls.length)).toBe(2);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("blocked lesson audio offers manual recovery and hidden tabs stop playback", async ({
  page,
}) => {
  await mockAudio(page, true);
  await openLesson(page);
  const sound = page
    .getByRole("button", { name: /^Play pronunciation for/ })
    .first();
  await sound.click();
  await expect(page.getByRole("status")).toContainText("Tap the sound button");
  await page.evaluate(() => {
    window.audioTest.blocked = false;
  });
  await sound.click();
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

test("missing lesson audio does not prevent practicing", async ({ page }) => {
  await page.route("**/audio/ja/*.mp3", (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
  await openLesson(page);
  await page
    .getByRole("button", { name: /^Play pronunciation for/ })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText("Audio unavailable");
  await page.getByRole("button", { name: "Let’s practice" }).click();
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2030-01-02T00:00:00Z"));
  await page.locator(".answer-button").first().click();
  await page.clock.runFor(2000);
  await expect(page.locator(".quiz-top strong")).toHaveText("2 / 10");
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
