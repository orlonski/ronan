import { test, expect } from "@playwright/test";

const USR = process.env.E2E_MOTORISTA_USR ?? "joao.silva";
const PASS = process.env.E2E_MOTORISTA_PASS ?? "motorista123";

async function loginMotorista(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[autocomplete="username"]', USR);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"));
}

test.describe("Motorista: PWA", () => {
  test("login e visualização da home", async ({ page }) => {
    await loginMotorista(page);
    await expect(page.getByText(/Olá,/i)).toBeVisible();
    await expect(page.locator("nav").last()).toBeVisible();
  });

  test("navegação para Nova viagem mostra o formulário", async ({ page }) => {
    await loginMotorista(page);
    await page.goto("/nova-viagem");
    await expect(page.getByRole("heading", { name: /Nova viagem/ })).toBeVisible();
    await expect(page.getByText("Toneladas")).toBeVisible();
    await expect(page.getByText("Local de carga")).toBeVisible();
    await expect(page.getByRole("button", { name: /Salvar viagem/i })).toBeVisible();
  });

  test("navegação para Novo pedágio mostra o formulário", async ({ page }) => {
    await loginMotorista(page);
    await page.goto("/novo-pedagio");
    await expect(page.getByRole("heading", { name: /Novo pedágio/ })).toBeVisible();
    await expect(page.getByText(/Pra[çc]a de pedágio/i)).toBeVisible();
  });

  test("perfil mostra dados e botão de sair", async ({ page }) => {
    await loginMotorista(page);
    await page.goto("/perfil");
    await expect(page.getByText(/Trocar senha/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Sair/i })).toBeVisible();
  });
});
