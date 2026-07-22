import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev -p 3100",
    url: "http://127.0.0.1:3100/PriceTrace",
    reuseExistingServer: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
