import { defineConfig, devices } from "@playwright/test";
import { NOMES_VIEWPORTS, VIEWPORTS } from "./tests/ux/viewports";

/**
 * Projetos de UX (tests/ux): um por viewport — `mobile`, `mac1440`, `mac1280`, `ultra`.
 * Falam com o stack LOCAL DE MEDIDAS (painel :3101 + API :3100, ver tests/ux/subir-stack.sh),
 * não com o painel do E2E (:3001). Por isso só entram na lista quando pedidos:
 * `UX=1` (os scripts `pnpm ux*` já setam) ou `--project=<viewport>` na linha de comando.
 * Assim `pnpm exec playwright test` continua sendo só o E2E de sempre.
 */
const pedeUx =
  process.env.UX === "1" ||
  process.argv.some((a, i, todos) => {
    const alvo = a.startsWith("--project=") ? a.slice("--project=".length) : todos[i - 1] === "--project" ? a : "";
    return (NOMES_VIEWPORTS as string[]).includes(alvo);
  });

const uxProjects = pedeUx
  ? NOMES_VIEWPORTS.map((nome) => ({
      name: nome,
      testDir: "./tests/ux",
      testMatch: /.*\.dashboard\.spec\.ts$/,
      // o baseline visual é só do ultrawide
      testIgnore: nome === "ultra" ? [] : [/ultra\.dashboard\.spec\.ts$/],
      outputDir: `./tests/ux/resultados/${nome}`,
      // sem sufixo de projeto/plataforma: um baseline por rota, em tests/ux/baseline/ultra/
      snapshotPathTemplate: "{testDir}/baseline/ultra/{arg}{ext}",
      use: {
        ...VIEWPORTS[nome],
        baseURL: process.env.UX_DASH ?? "http://localhost:3101",
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        colorScheme: "light" as const,
      },
    }))
  : [];

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
    ...uxProjects,
  ],
});
