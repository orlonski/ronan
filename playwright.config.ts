import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    actionTimeout: 10_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "dashboard",
      testMatch: /.*\.dashboard\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3001",
      },
    },
    {
      name: "motorista-pwa",
      testMatch: /.*\.motorista\.spec\.ts$/,
      use: {
        ...devices["Pixel 7"],
        baseURL: "http://localhost:3002",
      },
    },
  ],
});
