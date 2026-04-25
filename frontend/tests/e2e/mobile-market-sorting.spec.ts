import { expect, test } from "@playwright/test";
import { mockAuthedApi } from "../visual/helpers/mock-api";

function firstMobilePlayerName(page: import("@playwright/test").Page) {
  return page.locator(".market-mobile-table tbody tr").first().locator(".market-mobile-player-name");
}

test("mobile market table cells sort rows without table headers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthedApi(page);

  await page.goto("/market");
  await page.waitForLoadState("networkidle");

  await expect(firstMobilePlayerName(page)).toHaveText("A. Judge");

  await page.locator(".market-mobile-price-cell").first().click();
  await expect(firstMobilePlayerName(page)).toHaveText("M. Betts");

  await page.locator(".market-mobile-table tbody tr").first().locator(".market-sticky-player-cell").click();
  await expect(firstMobilePlayerName(page)).toHaveText("A. Judge");
});
