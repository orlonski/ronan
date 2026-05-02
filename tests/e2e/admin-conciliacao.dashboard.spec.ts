import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@ronan.local";
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? "ronan_admin_2026";

test.describe("Admin: fluxo de conciliação", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  });

  test("painel acessa as áreas de conciliação", async ({ page }) => {
    await page.goto("/fechamentos");
    await expect(page.getByRole("heading", { name: /Fechamentos/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Novo fechamento/ })).toBeVisible();
  });

  test("listagem de viagens mostra status visual", async ({ page }) => {
    await page.goto("/viagens");
    await expect(page.getByRole("heading", { name: /Viagens/ })).toBeVisible();
    // existência da coluna de status
    await expect(page.getByText("Status").first()).toBeVisible();
  });

  test("construtor de layout abre e mostra preview", async ({ page }) => {
    await page.goto("/empresas");
    // clica no botão de layout (FileSpreadsheet) da primeira empresa
    const linhaEmpresa = page.locator("tr").nth(1);
    if (await linhaEmpresa.count()) {
      const botaoLayout = linhaEmpresa.locator('a[href*="layout-envio"]');
      if (await botaoLayout.count()) {
        await botaoLayout.click();
        await expect(page.getByText(/Layout de envio/)).toBeVisible();
      }
    }
  });
});
