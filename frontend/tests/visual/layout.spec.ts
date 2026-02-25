import { expect, test } from "@playwright/test";
import { mockAuthedApi, mockGuestApi, stabilizeUi } from "./helpers/mock-api";

test.describe("Desktop baselines", () => {
  test("home page layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only baseline.");
    await mockGuestApi(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("home-desktop.png", { fullPage: true });
  });

  test("market page layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/market");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("market-desktop.png", { fullPage: true });
  });

  test("market page right-edge horizontal scroll", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/market");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      window.scrollTo({ left: document.documentElement.scrollWidth, top: 0, behavior: "auto" });
    });
    await page.waitForTimeout(150);
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("market-desktop-scroll-right.png");
  });

  test("community page layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/community");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("community-desktop.png", { fullPage: true });
  });

  test("portfolio page layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/portfolio");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("portfolio-desktop.png", { fullPage: true });
  });

  test("player page layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/player/101");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("player-desktop.png", { fullPage: true });
  });

  test("live page layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/live");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("live-desktop.png", { fullPage: true });
  });

  test("settings page layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "Desktop-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("settings-desktop.png", { fullPage: true });
  });
});

test.describe("Mobile baselines", () => {
  test("market page mobile layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/market");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("market-mobile.png", { fullPage: true });
  });

  test("community page mobile layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/community");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("community-mobile.png", { fullPage: true });
  });

  test("portfolio page mobile layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/portfolio");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("portfolio-mobile.png", { fullPage: true });
  });

  test("live page mobile layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/live");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("live-mobile.png", { fullPage: true });
  });

  test("settings page mobile layout", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only baseline.");
    await mockAuthedApi(page);

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await stabilizeUi(page);

    await expect(page).toHaveScreenshot("settings-mobile.png", { fullPage: true });
  });
});
