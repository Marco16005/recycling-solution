import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/** Corre en el servicio e2e de compose.test.yaml contra la imagen de producción (servicio web). */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // El service worker de /operador exige un origen seguro; en la prueba, la aplicación corre en http://web:3000.
        // Solo el Chromium completo (headless nuevo) respeta la bandera; el headless shell la ignora.
        channel: "chromium",
        launchOptions: { args: [`--unsafely-treat-insecure-origin-as-secure=${new URL(baseURL).origin}`] },
      },
    },
  ],
});
