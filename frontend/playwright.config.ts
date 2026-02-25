import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_FRONTEND_PORT || 3000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
