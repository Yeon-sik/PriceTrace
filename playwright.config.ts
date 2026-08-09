import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev -p 3100",
    url: "http://127.0.0.1:3100/PriceTrace",
    reuseExistingServer: true,
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_SUPABASE_URL: "https://pricetrace.example.test",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-price-trace-publishable-key",
      NEXT_PUBLIC_NUTRITION_SUPABASE_URL: "https://nutrition.example.test",
      NEXT_PUBLIC_NUTRITION_SUPABASE_PUBLISHABLE_KEY: "e2e-nutrition-publishable-key",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
