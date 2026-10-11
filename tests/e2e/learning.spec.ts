import { expect, test, type Page } from "@playwright/test";
import { groups } from "../../lib/kana/catalog";

const readings = new Map(
  groups.flatMap((group) =>
    group.items.map((item) => [item.glyph, item.reading] as const),
  ),
);

async function session(page: Page, makeMistake = false) {
  for (let index = 0; index < 10; index++) {
    const glyph = await page.locator(".question-glyph").textContent();
    const reading = readings.get(glyph!);
    expect(reading).toBeTruthy();
    const choices = page.locator(".answer-button");
    await expect(choices).toHaveCount(4);
    if (makeMistake && index === 0) {
      const options = await choices.allTextContents();
      const correctIndex = options.findIndex(
        (option) => option.trim().replace(/^\d+/, "").trim() === reading,
      );
      expect(correctIndex).toBeGreaterThanOrEqual(0);
      await choices.nth((correctIndex + 1) % 4).click();
    } else
      await choices
        .filter({
          has: page
            .locator("span")
            .filter({ hasText: new RegExp(`^${reading}$`) }),
        })
        .click();
    await expect(page.getByRole("status").last()).toContainText(
      `is read ${reading}`,
    );
    for (const button of await choices.all())
      await expect(button).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: index === 9 ? "See results" : "Continue",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(".result-page")).toBeVisible();
}

test("learn, complete, persist and review mistakes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue learning", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "The vowels" })).toBeVisible();
  await expect(page.locator(".kana-tile")).toHaveCount(5);
  await page.getByRole("button", { name: "Let’s practice" }).click();
  await session(page, true);
  await expect(page.locator(".result-stats")).toContainText("90");
  await page.reload();
  await expect(page.locator(".track-card.hiragana")).toContainText(
    "1 of 27 groups completed",
  );
  await page
    .getByRole("button", { name: "Review mistakes", exact: true })
    .click();
  await session(page);
  await page.getByRole("button", { name: "Nihongo overview" }).click();
  await expect(
    page.getByRole("button", { name: "Review mistakes", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Review mistakes", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("both alphabets, borrowed sounds, context and chart filters", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Learn kana", exact: true }).click();
  await page.getByRole("button", { name: "Katakana", exact: true }).click();
  await page.getByRole("button", { name: /The F sounds/ }).click();
  await expect(page.locator(".lesson-tiles")).toContainText("ファ");
  await page.getByRole("button", { name: "Let’s practice" }).click();
  await session(page);
  await page.getByRole("button", { name: "Explore all groups" }).click();
  await page.getByRole("button", { name: /Hold the vowel/ }).click();
  await expect(page.locator(".lesson-note")).toContainText(
    "has no reading by itself",
  );
  await expect(page.locator(".lesson-tiles")).toContainText("kōhī");
  await page.getByRole("button", { name: "Kana chart" }).click();
  await page.getByLabel("Find a character or sound").fill("fa");
  await expect(page.locator(".chart-tiles .kana-tile")).toHaveCount(1);
  await expect(page.locator(".chart-tiles")).toContainText("ファ");
  await page.getByLabel("Find a character or sound").fill("xyz");
  await expect(
    page.getByRole("heading", { name: "No matching sounds yet." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".chart-group")).toHaveCount(34);
  await page
    .getByRole("combobox", { name: "Show groups" })
    .selectOption("foreign");
  await page.getByRole("button", { name: "Hiragana", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Show groups" })).toHaveValue(
    "all",
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("invalid progress recovers and denied storage stays usable", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("nihongo:progress:v1", "{invalid"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue learning", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".track-card.hiragana")).toContainText("0 of 27");
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage disabled");
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("status")).toContainText("cannot save progress");
  await page
    .getByRole("button", { name: "Continue learning", exact: true })
    .click();
  await page.getByRole("button", { name: "Let’s practice" }).click();
  await session(page);
  await page.getByRole("button", { name: "Nihongo overview" }).click();
  await expect(page.locator(".track-card.hiragana")).toContainText("1 of 27");
});

test("keyboard navigation, reduced motion and responsive layout", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue learning", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Continue learning", exact: true })
    .click();
  await page.getByRole("button", { name: "Let’s practice" }).click();
  await expect(page.locator(".question-glyph")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Back to learning" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: /^Play pronunciation for/ }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".answer-button").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeFocused();
});

test("visual screens fit the viewport", async ({ page }, testInfo) => {
  async function capture(name: string) {
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`${name}.png`),
      fullPage: true,
    });
  }
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue learning", exact: true }),
  ).toBeEnabled();
  await capture("overview");
  await page.getByRole("button", { name: "Learn kana", exact: true }).click();
  await capture("learn");
  await page.getByRole("button", { name: "Katakana", exact: true }).click();
  await page.getByRole("button", { name: /Hold the vowel/ }).click();
  await capture("lesson");
  await page.getByRole("button", { name: "Let’s practice" }).click();
  await capture("quiz");
  await session(page);
  await capture("result");
  await page.getByRole("button", { name: "Kana chart", exact: true }).click();
  await page.getByLabel("Find a character or sound").fill("kōhī");
  await capture("chart");
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.getByRole("button", { name: "Learn kana", exact: true }).click();
    await capture("small-mobile");
  }
});
