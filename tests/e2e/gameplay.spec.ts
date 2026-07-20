import { expect, test } from "@playwright/test";

type ModeCheck = {
  readonly id: string;
  readonly readySelector: string;
  readonly minimumReadyCount?: number;
  readonly inputLabel?: string;
  readonly expectedAsset?: RegExp;
};

const ALL_GAME_MODES: readonly ModeCheck[] = [
  { id: "flags", readySelector: "img.flag-image", inputLabel: "Your guess", expectedAsset: /\/assets\/flags\/[a-z]{2}\.svg$/ },
  { id: "flag-colors", readySelector: "canvas.flag-color-reveal-canvas", inputLabel: "Your guess", expectedAsset: /\/assets\/flags\/[a-z]{2}\.svg$/ },
  { id: "shapes", readySelector: ".country-shape-prompt", inputLabel: "Your guess", expectedAsset: /\/assets\/country-shapes\/[a-z]{2}\.svg$/ },
  { id: "codes", readySelector: ".prompt-text", inputLabel: "Your guess" },
  { id: "capitals", readySelector: ".prompt-text", inputLabel: "Your guess" },
  { id: "capital-recall", readySelector: ".capital-recall-country", minimumReadyCount: 100, inputLabel: "Capital", expectedAsset: /\/assets\/world-map\.json$/ },
  { id: "name-all", readySelector: ".world-map-country", minimumReadyCount: 100, inputLabel: "Your guess", expectedAsset: /\/assets\/world-map\.json$/ },
  { id: "click-country", readySelector: ".world-map-country", minimumReadyCount: 100, expectedAsset: /\/assets\/world-map\.json$/ },
  { id: "spot-country", readySelector: ".world-map-country", minimumReadyCount: 100, inputLabel: "Your guess", expectedAsset: /\/assets\/world-map\.json$/ },
  { id: "puzzle", readySelector: ".puzzle-piece-card", minimumReadyCount: 20, expectedAsset: /\/assets\/world-map\.json$/ },
  { id: "map-tap", readySelector: ".maptap-globe" },
  { id: "streetview-country", readySelector: ".streetview-stage", inputLabel: "Your country guess" },
];

test("opens a game from the landing page and keeps its shareable URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Know the world by heart/i })).toBeVisible();

  await page.getByTestId("card-game-mode-flags").click();
  await expect(page).toHaveURL(/\/play\/flags$/);
  await expect(page.locator(".category-dropdown-selected")).toHaveText("Flags");
  await expect(page.getByLabel("Your guess")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/play\/flags$/);
  await expect(page.locator(".category-dropdown-selected")).toHaveText("Flags");
});

test("accepts a correct flag answer and updates feedback and score", async ({ page }) => {
  await page.goto("/play/flags");
  const prompt = page.locator("img.flag-image");
  await expect(prompt).toBeVisible();
  const src = await prompt.getAttribute("src");
  const countryCode = src?.match(/\/([a-z]{2})\.svg$/i)?.[1];
  expect(countryCode).toBeTruthy();

  await page.getByLabel("Your guess").fill(countryCode!.toUpperCase());
  await page.getByLabel("Your guess").press("Enter");
  await expect(page.locator(".feedback.good")).toContainText("Correct:");
  await expect(page.locator(".stats-panel .stat-value").first()).not.toHaveText("0");
});

test("opens the journey hub and persists game-feel settings", async ({ page }) => {
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Your journey" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Achievements" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Map mastery" })).toBeVisible();

  const sound = page.locator(".journey-setting-row", { hasText: "Sound effects" }).locator("input");
  await expect(sound).not.toBeChecked();
  await sound.check();
  await page.reload();
  await expect(sound).toBeChecked();
});

test("honors reduced-motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const star = page.locator(".landing-star.is-bright").first();
  await expect(star).toBeVisible();
  const animationDuration = await star.evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.000001);
});

test.describe("every shareable game mode", () => {
  test.describe.configure({ mode: "serial" });

  for (const mode of ALL_GAME_MODES) {
    test(`${mode.id} loads its complete game surface`, async ({ page }) => {
      const assetResponses: Array<{ url: string; status: number; contentType: string }> = [];
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (url.origin !== "http://127.0.0.1:5173" || !url.pathname.startsWith("/assets/")) return;
        assetResponses.push({
          url: url.pathname,
          status: response.status(),
          contentType: response.headers()["content-type"] ?? "",
        });
      });

      // The browser suite runs against Vite without the optional Bun API. These
      // routes deliberately exercise the bundled offline rounds.
      await page.route("**/api/maptap/**", (route) => route.abort());
      await page.route("**/api/streetview-country/**", (route) => route.abort());

      await page.goto(`/play/${mode.id}`);
      await expect(page).toHaveURL(new RegExp(`/play/${mode.id}$`));
      await page.waitForTimeout(250);
      expect(pageErrors, `${mode.id} raised browser errors`).toEqual([]);
      const readySurface = page.locator(mode.readySelector);
      await expect(readySurface.first()).toBeVisible({ timeout: 15_000 });
      if (mode.minimumReadyCount) {
        await expect.poll(() => readySurface.count()).toBeGreaterThanOrEqual(mode.minimumReadyCount);
      } else {
        await expect(readySurface).toHaveCount(1);
      }
      await expect(page.locator(".loading-screen")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("The string did not match the expected pattern");
      await expect(page.locator("body")).not.toContainText("Unable to load world map data");

      if (mode.inputLabel) await expect(page.getByRole("textbox", { name: mode.inputLabel, exact: true })).toBeVisible();

      if (mode.id === "flags") {
        await expect.poll(() => page.locator("img.flag-image").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      }
      if (mode.id === "shapes") {
        await expect(page.locator(".country-shape-prompt")).toHaveCSS("background-image", /\/assets\/country-shapes\/[a-z]{2}\.svg/);
      }
      if (mode.id === "map-tap") {
        await expect(page.locator(".maptap-prompt-meta")).not.toHaveText("", { timeout: 15_000 });
        await expect(page.locator(".maptap-status")).not.toContainText("Could not load");
      }
      if (mode.id === "streetview-country") {
        const missingKey = page.locator(".streetview-missing-key");
        if (await missingKey.isVisible()) await expect(missingKey).toContainText("API key missing");
        else await expect(page.locator(".streetview-frame.is-active")).toBeVisible();
      }

      expect(assetResponses.filter((response) => response.status >= 400), `${mode.id} had failed local assets`).toEqual([]);
      if (mode.expectedAsset) {
        const expected = assetResponses.find((response) => mode.expectedAsset!.test(response.url));
        expect(expected, `${mode.id} did not request ${String(mode.expectedAsset)}`).toBeDefined();
        expect(expected!.contentType).not.toContain("text/html");
      }
    });
  }
});
