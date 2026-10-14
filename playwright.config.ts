import { defineConfig, devices } from "@playwright/test";

/** Corre en el servicio e2e de compose.test.yaml contra la imagen de producción (servicio web). */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
