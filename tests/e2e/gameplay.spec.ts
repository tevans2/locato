import { expect, test } from "@playwright/test";

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
