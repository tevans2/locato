import { expect, test } from "@playwright/test";

test("keeps navigation reachable on a phone-sized viewport", async ({ page }) => {
  await page.goto("/play/flags");
  await expect(page.getByLabel("Your guess")).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Daily Challenge" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Leaderboards" })).toBeVisible();

  await menu.getByRole("button", { name: "Leaderboards" }).click();
  await expect(page).toHaveURL(/\/leaderboards\/flags$/);
  await expect(page.getByRole("heading", { name: "Leaderboards" })).toBeVisible();
});
