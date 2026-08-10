import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "../.venv/bin/uvicorn autoeval_api.main:app --app-dir ../backend/src --port 8000",
      url: "http://localhost:8000/api/health",
      reuseExistingServer: !process.env.CI,
      env: {
        AUTOEVAL_ENV: "test",
        AUTOEVAL_DATABASE_URL: "sqlite://",
        AUTOEVAL_WEB_ORIGINS: "http://localhost:3000",
        AUTOEVAL_ALLOWED_HOSTS: "localhost,127.0.0.1,testserver",
        ENABLE_CLI_PROVIDERS: "false",
        OPENROUTER_API_KEY: "",
      },
    },
    {
      command: "npm run build && npm run start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_API_URL: "http://localhost:8000/api",
      },
    },
  ],
});
