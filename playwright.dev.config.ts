import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/development",
  outputDir: "/tmp/muscle-playwright-dev-results",
  use: { ...base.use, baseURL: "http://127.0.0.1:3103" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3103",
    url: "http://127.0.0.1:3103",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
