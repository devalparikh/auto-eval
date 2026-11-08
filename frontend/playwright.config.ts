import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const apiPort = process.env.AUTOEVAL_E2E_API_PORT ?? "8011";
const webPort = process.env.AUTOEVAL_E2E_WEB_PORT ?? "3011";
const apiUrl = `http://localhost:${apiPort}`;
const webUrl = `http://localhost:${webPort}`;

// A file database, as `make dev` uses. `sqlite://` shares one connection across
// the API's threads, and parallel workers segfault it inside SQLAlchemy.
const databaseUrl =
  process.env.AUTOEVAL_E2E_DATABASE_URL ??
  `sqlite:///${join(mkdtempSync(join(tmpdir(), "autoeval-e2e-")), "e2e.db")}`;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `../.venv/bin/uvicorn autoeval_api.main:app --app-dir ../backend/src --port ${apiPort}`,
      url: `${apiUrl}/api/health`,
      reuseExistingServer: false,
      env: {
        AUTOEVAL_ENV: "test",
        AUTOEVAL_DATABASE_URL: databaseUrl,
        AUTOEVAL_WEB_ORIGINS: webUrl,
        AUTOEVAL_ALLOWED_HOSTS: "localhost,127.0.0.1,testserver",
        ENABLE_CLI_PROVIDERS: "false",
        ENABLE_LM_STUDIO: "false",
        LM_STUDIO_MODELS: "",
        LM_STUDIO_API_TOKEN: "",
        OPENROUTER_API_KEY: "",
      },
    },
    {
      command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: `${apiUrl}/api`,
      },
    },
  ],
});
