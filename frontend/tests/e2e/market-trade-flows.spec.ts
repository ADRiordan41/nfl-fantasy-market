import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { setupMarketTradeMockApi } from "./helpers/market-trade-mock-api";

async function loadMarket(page: Page) {
  await page.goto("/market");
  await page.waitForLoadState("networkidle");
}

function rowForPlayer(page: Page, playerName: string) {
  return page.locator("tbody tr", { hasText: playerName }).first();
}

test.describe("Market trade flows", () => {
  test("buy flow: preview then execute updates holdings and cash", async ({ page }) => {
    const { playerName, tradeCalls } = await setupMarketTradeMockApi(page, { initialSharesOwned: 0 });
    await loadMarket(page);

    const row = rowForPlayer(page, playerName);
    await row.locator(".market-qty-input").fill("5");
    await row.getByRole("button", { name: "Preview" }).click();
    await expect(row.locator(".market-quote-main")).toContainText("Cost: $1,500.00");

    await row.getByRole("button", { name: "Execute" }).click();
    await expect(page.locator(".hero-metrics .kpi-card").nth(0)).toContainText("$98,500.00");
    await expect(row.locator("td.market-owned-cell").nth(0)).toHaveText("5");
    await expect(row.locator("td.market-owned-cell").nth(1)).toHaveText("0");
    await expect(row.getByRole("button", { name: "Preview" })).toBeVisible();

    expect(tradeCalls).toEqual([
      { phase: "quote", side: "buy", playerId: 5001, shares: 5 },
      { phase: "trade", side: "buy", playerId: 5001, shares: 5 },
    ]);
  });

  test("sell flow: preview then execute reduces held shares and increases cash", async ({ page }) => {
    const { playerName, tradeCalls } = await setupMarketTradeMockApi(page, { initialSharesOwned: 9 });
    await loadMarket(page);

    const row = rowForPlayer(page, playerName);
    await row.locator(".market-side-select").selectOption("SELL");
    await row.locator(".market-qty-input").fill("4");
    await row.getByRole("button", { name: "Preview" }).click();
    await expect(row.locator(".market-quote-main")).toContainText("Proceeds: $1,200.00");

    await row.getByRole("button", { name: "Execute" }).click();
    await expect(page.locator(".hero-metrics .kpi-card").nth(0)).toContainText("$101,200.00");
    await expect(row.locator("td.market-owned-cell").nth(0)).toHaveText("5");
    await expect(row.locator("td.market-owned-cell").nth(1)).toHaveText("0");
    await expect(row.getByRole("button", { name: "Preview" })).toBeVisible();

    expect(tradeCalls).toEqual([
      { phase: "quote", side: "sell", playerId: 5001, shares: 4 },
      { phase: "trade", side: "sell", playerId: 5001, shares: 4 },
    ]);
  });

  test("short flow: preview then execute increases short shares and cash", async ({ page }) => {
    const { playerName, tradeCalls } = await setupMarketTradeMockApi(page, { initialSharesOwned: 0 });
    await loadMarket(page);

    const row = rowForPlayer(page, playerName);
    await row.locator(".market-side-select").selectOption("SHORT");
    await row.locator(".market-qty-input").fill("3");
    await row.getByRole("button", { name: "Preview" }).click();
    await expect(row.locator(".market-quote-main")).toContainText("Proceeds: $900.00");

    await row.getByRole("button", { name: "Execute" }).click();
    await expect(page.locator(".hero-metrics .kpi-card").nth(0)).toContainText("$100,900.00");
    await expect(row.locator("td.market-owned-cell").nth(0)).toHaveText("0");
    await expect(row.locator("td.market-owned-cell").nth(1)).toHaveText("3");
    await expect(row.getByRole("button", { name: "Preview" })).toBeVisible();

    expect(tradeCalls).toEqual([
      { phase: "quote", side: "short", playerId: 5001, shares: 3 },
      { phase: "trade", side: "short", playerId: 5001, shares: 3 },
    ]);
  });

  test("cover flow: preview then execute reduces short shares and cash", async ({ page }) => {
    const { playerName, tradeCalls } = await setupMarketTradeMockApi(page, { initialSharesOwned: -7 });
    await loadMarket(page);

    const row = rowForPlayer(page, playerName);
    await row.locator(".market-side-select").selectOption("COVER");
    await row.locator(".market-qty-input").fill("2");
    await row.getByRole("button", { name: "Preview" }).click();
    await expect(row.locator(".market-quote-main")).toContainText("Cost: $600.00");

    await row.getByRole("button", { name: "Execute" }).click();
    await expect(page.locator(".hero-metrics .kpi-card").nth(0)).toContainText("$99,400.00");
    await expect(row.locator("td.market-owned-cell").nth(0)).toHaveText("0");
    await expect(row.locator("td.market-owned-cell").nth(1)).toHaveText("5");
    await expect(row.getByRole("button", { name: "Preview" })).toBeVisible();

    expect(tradeCalls).toEqual([
      { phase: "quote", side: "cover", playerId: 5001, shares: 2 },
      { phase: "trade", side: "cover", playerId: 5001, shares: 2 },
    ]);
  });
});
