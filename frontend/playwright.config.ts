import { defineConfig, devices } from "@playwright/test";

const apiPort = process.env.AUTOEVAL_E2E_API_PORT ?? "8000";
const webPort = process.env.AUTOEVAL_E2E_WEB_PORT ?? "3000";
const apiUrl = `http://localhost:${apiPort}`;
const webUrl = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `../.venv/bin/uvicorn autoeval_api.main:app --app-dir ../backend/src --port ${apiPort}`,
      url: `${apiUrl}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        AUTOEVAL_ENV: "test",
        AUTOEVAL_DATABASE_URL: "sqlite://",
        AUTOEVAL_WEB_ORIGINS: webUrl,
        AUTOEVAL_ALLOWED_HOSTS: "localhost,127.0.0.1,testserver",
        ENABLE_CLI_PROVIDERS: "false",
        OPENROUTER_API_KEY: "",
      },
    },
    {
      command: `npm run build && npm run start -- --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_API_URL: `${apiUrl}/api`,
      },
    },
  ],
});
