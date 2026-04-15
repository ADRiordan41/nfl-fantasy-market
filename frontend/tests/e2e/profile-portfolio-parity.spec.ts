import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { setupProfilePortfolioParityMockApi } from "./helpers/profile-portfolio-parity-mock-api";

async function paritySectionsFor(pagePath: string, page: Page) {
  await page.goto(pagePath);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-parity-section="account-mix"]').first().waitFor();
  await page.locator('[data-parity-section="community-posts"]').first().waitFor();
  return page.locator("[data-parity-section]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-parity-section") ?? "").filter(Boolean),
  );
}

test("portfolio and profile keep mirrored sections in sync", async ({ page }) => {
  await setupProfilePortfolioParityMockApi(page);

  const portfolioSections = await paritySectionsFor("/portfolio", page);
  const profileSections = await paritySectionsFor("/profile/teammate", page);

  expect(portfolioSections).toEqual(profileSections);
  expect(portfolioSections).toEqual(["account-mix", "community-posts"]);
});
