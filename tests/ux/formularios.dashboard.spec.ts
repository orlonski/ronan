import type { Page } from "@playwright/test";
import { test, expect, abrirRota, entrarComo, DASH } from "./ambiente";
import { rotasDeFormulario } from "./formularios-rotas";
import type { Rota } from "./rotas";

/**
 * Formulários como app no celular (Leva 1, fatia 6).
 *  - barra de ação FIXA no celular x fluxo normal (flex justify-end) de 768px pra cima;
 *  - teclado certo por campo (atributos HTML) nos formulários principais — vale em TODOS os viewports;
 *  - alvo de toque de checkbox/radio (>= 44px no celular, desenho de sempre no desktop);
 *  - foco no iOS (campo vai pro meio da área visível) e grades de 1 coluna.
 * Só abre e olha: o contexto do `test` aborta qualquer escrita (o "salvar de verdade" é provado à parte, num banco de teste).
 */
let FORMS: Rota[] = [];
test.beforeAll(async () => {
  FORMS = await rotasDeFormulario();
});
const form = (id: string) => FORMS.find((r) => r.id === id)!;

async function abrir(page: Page, id: string) {
  await abrirRota(page, form(id));
  const pular = page.getByRole("button", { name: "Pular" });
  if (await pular.count()) await pular.click().catch(() => {});
  await page.waitForTimeout(200);
}
/** Quem rola é a janela (o <main> cresce com o conteúdo); se um dia o <main> virar o scroller, também vale. */
const rolarPara = (page: Page, fracao: number) =>
  page.evaluate((f) => {
    const main = document.getElementById("conteudo")!;
    const el = main.scrollHeight > main.clientHeight + 1 ? main : document.scrollingElement!;
    el.scrollTo(0, (el.scrollHeight - el.clientHeight) * f);
  }, fracao);
const rolarAoFim = (page: Page) => rolarPara(page, 1);
const ehMobile = (nome: string) => nome === "mobile";

test.describe("barra de ação", () => {
  for (const id of ["motorista-novo", "veiculo-novo", "cliente-novo", "local-novo", "abastecimento-editar", "empresa-novo", "transportadora-novo", "usuario-novo", "envio-novo"]) {
    test(`${id}: fixa e colada no rodapé no celular; no desktop é o flex de sempre, no fim do formulário`, async ({ page }, info) => {
      await abrir(page, id);
      const fixa = page.locator("[data-barra-de-acao-fixa]");
      const externa = page.locator("[data-barra-de-acao]");
      await expect(fixa).toHaveCount(1);
      const submit = fixa.locator("button[type=submit]");
      if (ehMobile(info.project.name)) {
        const vh = page.viewportSize()!.height;
        const vw = page.viewportSize()!.width;
        for (const f of [0, 1]) {
          await rolarPara(page, f);
          await page.waitForTimeout(200);
          const b = (await fixa.boundingBox())!;
          expect(await fixa.evaluate((e) => getComputedStyle(e).position)).toBe("fixed");
          expect(Math.round(b.y + b.height)).toBe(vh);
          expect(Math.round(b.width)).toBe(vw);
          const s = (await submit.boundingBox())!;
          expect(s.height).toBeGreaterThanOrEqual(47.5);
          expect(s.width).toBeGreaterThan(vw / 2); // o primário é o maior dos dois botões
        }
        // fim da rolagem: o último campo/rótulo NÃO fica por baixo da barra
        await rolarAoFim(page);
        await page.waitForTimeout(300);
        const barraTopo = (await fixa.boundingBox())!.y;
        const ultimo = await page.evaluate(() => {
          const barra = document.querySelector("[data-barra-de-acao-fixa]")!;
          const els = Array.from(document.querySelectorAll("#conteudo input:not([type=hidden]), #conteudo select, #conteudo textarea, #conteudo button[role=combobox], #conteudo p, #conteudo label")).filter((e) => {
            const r = e.getBoundingClientRect();
            return r.height > 0 && !barra.contains(e) && (e as HTMLElement).checkVisibility();
          });
          return Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
        });
        expect(ultimo).toBeLessThanOrEqual(barraTopo + 0.5);
      } else {
        // desktop: o invólucro vira `contents` e os botões ficam no flex justify-end de sempre
        expect(await fixa.evaluate((e) => getComputedStyle(e).display)).toBe("contents");
        const cs = await externa.evaluate((e) => ({ d: getComputedStyle(e).display, j: getComputedStyle(e).justifyContent, p: getComputedStyle(e).position }));
        expect(cs).toMatchObject({ d: "flex", j: "flex-end", p: "static" });
        const s = (await submit.boundingBox())!;
        expect(s.height).toBeLessThan(44); // não virou o botão de 48px do celular
        // o botão acompanha o fim do formulário (não fica preso na tela): rolar muda a posição dele
        const y0 = (await submit.boundingBox())!.y;
        await rolarAoFim(page);
        await page.waitForTimeout(150);
        const y1 = (await submit.boundingBox())!.y;
        const rolou = await page.evaluate(() => document.scrollingElement!.scrollHeight > window.innerHeight + 1);
        if (rolou) expect(y1).toBeLessThan(y0);
      }
    });
  }

  test("celular: a barra some com o teclado aberto e volta ao sair do campo", async ({ page }, info) => {
    test.skip(!ehMobile(info.project.name), "só no celular");
    await abrir(page, "veiculo-novo");
    const fixa = page.locator("[data-barra-de-acao-fixa]");
    await expect(fixa).toBeVisible();
    const campo = page.locator("#veiculofor-modelo");
    await campo.focus();
    await expect(fixa).toBeHidden();
    await campo.blur();
    await expect(fixa).toBeVisible();
  });

  test("celular: Cancelar com alteração (sujo) continua pedindo confirmação; sem alteração sai direto", async ({ page }, info) => {
    test.skip(!ehMobile(info.project.name), "só no celular");
    await abrir(page, "motorista-editar");
    await page.locator("#mot-nome").fill("Nome alterado no teste");
    await page.locator("#mot-nome").blur();
    await page.locator("[data-barra-de-acao-fixa]").getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("alertdialog").or(page.getByRole("dialog")).getByText("Sair sem salvar?")).toBeVisible();
    await page.getByRole("button", { name: "Continuar editando" }).click();
    await expect(page.getByText("Sair sem salvar?")).toBeHidden();
    await expect(page).toHaveURL(/\/editar$/);
  });
});

test.describe("teclado certo por campo", () => {
  const attrs = (page: Page, sel: string) =>
    page.locator(sel).first().evaluate((e) => {
      const i = e as HTMLInputElement;
      return { type: i.type, inputmode: i.getAttribute("inputmode"), autocomplete: i.getAttribute("autocomplete"), autocapitalize: i.getAttribute("autocapitalize"), autocorrect: i.getAttribute("autocorrect"), spellcheck: i.getAttribute("spellcheck") };
    });

  test("motorista: CPF numérico, telefone tel, e-mail e senha nova", async ({ page }) => {
    await abrir(page, "motorista-novo");
    expect(await attrs(page, "#mot-cpf")).toMatchObject({ inputmode: "numeric", autocapitalize: "none", autocorrect: "off" });
    expect(await attrs(page, "#mot-telefone")).toMatchObject({ type: "tel", inputmode: "tel", autocorrect: "off" });
    expect(await attrs(page, "#mot-email")).toMatchObject({ type: "email", inputmode: "email", autocapitalize: "none", autocorrect: "off", spellcheck: "false" });
    expect(await attrs(page, "#mot-nome")).toMatchObject({ autocapitalize: "words" });
    expect(await attrs(page, "input[type=password]")).toMatchObject({ autocomplete: "new-password" });
    // placa do veículo extra (aparece ao clicar em "Adicionar placa"): caixa alta e sem corretor
    await page.getByRole("button", { name: "Adicionar placa" }).click();
    expect(await attrs(page, 'input[placeholder="ABC1D23"]')).toMatchObject({ autocapitalize: "characters", autocorrect: "off", spellcheck: "false" });
  });
  test("veículo: placa em caixa alta, sem corretor", async ({ page }) => {
    await abrir(page, "veiculo-novo");
    expect(await attrs(page, "#veiculofor-placa")).toMatchObject({ autocapitalize: "characters", autocorrect: "off", spellcheck: "false" });
  });
  test("local: CEP numérico, UF em caixa alta", async ({ page }) => {
    await abrir(page, "local-novo");
    expect(await attrs(page, "#localform-cep")).toMatchObject({ inputmode: "numeric" });
    expect(await attrs(page, "#localform-uf")).toMatchObject({ autocapitalize: "characters", autocorrect: "off" });
  });
  test("abastecimento: litros e valor decimais, odômetro numérico", async ({ page }) => {
    await abrir(page, "abastecimento-editar");
    expect(await attrs(page, "#abastecime-litros")).toMatchObject({ inputmode: "decimal" });
    expect(await attrs(page, "#abastecime-valor-total-r")).toMatchObject({ inputmode: "decimal" });
    expect(await attrs(page, "#abastecime-odometro")).toMatchObject({ inputmode: "numeric" });
  });
  test("empresa e transportadora: CNPJ/CPF numérico", async ({ page }) => {
    await abrir(page, "empresa-novo");
    expect(await attrs(page, "#empresafor-cnpj-ou-cpf")).toMatchObject({ inputmode: "numeric", autocorrect: "off" });
    await abrir(page, "transportadora-novo");
    expect(await attrs(page, "#transporta-cnpj-ou-cpf")).toMatchObject({ inputmode: "numeric", autocorrect: "off" });
  });
  test("usuário: e-mail e senha nova; WhatsApp tel", async ({ page }) => {
    await abrir(page, "usuario-novo");
    expect(await attrs(page, "#usuariofor-email")).toMatchObject({ type: "email", autocapitalize: "none" });
    expect(await attrs(page, "input[type=password]")).toMatchObject({ autocomplete: "new-password" });
    expect(await attrs(page, "#usuariofor-resumo-diario-no-whatsapp")).toMatchObject({ type: "tel", inputmode: "tel" });
  });
  test("login e cadastro (sem sessão): e-mail, senha atual / nova, telefone", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(DASH + "/login", { waitUntil: "domcontentloaded" });
    await page.locator("#email").waitFor();
    expect(await attrs(page, "#email")).toMatchObject({ type: "email", inputmode: "email", autocomplete: "email", autocapitalize: "none", autocorrect: "off" });
    expect(await attrs(page, "#senha")).toMatchObject({ type: "password", autocomplete: "current-password" });
    await page.goto(DASH + "/cadastro", { waitUntil: "domcontentloaded" });
    await page.locator("#adminSenha").waitFor();
    expect(await attrs(page, "#adminSenha")).toMatchObject({ autocomplete: "new-password" });
    expect(await attrs(page, "#telefone")).toMatchObject({ type: "tel", autocomplete: "tel" });
    expect(await attrs(page, "#adminEmail")).toMatchObject({ type: "email", autocapitalize: "none" });
    expect(await attrs(page, "#adminNome")).toMatchObject({ autocomplete: "name", autocapitalize: "words" });
    await entrarComo(page, "admin");
  });
  test("busca dos seletores e das tabelas: tecla 'Buscar'", async ({ page }) => {
    await abrirRota(page, { id: "motoristas", rotulo: "Motoristas", url: "/motoristas" });
    const pular = page.getByRole("button", { name: "Pular" });
    if (await pular.count()) await pular.click().catch(() => {});
    const busca = page.locator("#conteudo input[placeholder*='uscar' i]").first();
    await expect(busca).toHaveAttribute("enterkeyhint", "search");
    await expect(busca).toHaveAttribute("inputmode", "search");
  });
});

test.describe("checkbox e radio", () => {
  test("celular: o rótulo que embrulha o campo tem >= 44px e o campo >= 20px; clicar no TEXTO marca; desktop segue como era", async ({ page }, info) => {
    await abrir(page, "abastecimento-editar");
    const rotulo = page.locator("label", { hasText: "Tanque cheio" });
    const caixa = rotulo.locator("input[type=checkbox]");
    const r = (await rotulo.boundingBox())!;
    const c = (await caixa.boundingBox())!;
    if (ehMobile(info.project.name)) {
      expect(r.height).toBeGreaterThanOrEqual(43.5);
      expect(c.width).toBeGreaterThanOrEqual(19.5);
      const antes = await caixa.isChecked();
      await rotulo.locator("text=Tanque cheio").click(); // toque no texto, não na caixa
      expect(await caixa.isChecked()).toBe(!antes);
      await rotulo.locator("text=Tanque cheio").click();
      expect(await caixa.isChecked()).toBe(antes);
    } else {
      expect(r.height).toBeLessThan(44);
      expect(c.width).toBeLessThanOrEqual(16.5);
    }
  });
  test("celular: radios do acesso do usuário também ganham o alvo", async ({ page }, info) => {
    test.skip(!ehMobile(info.project.name), "só no celular");
    await abrir(page, "usuario-novo");
    const rotulos = page.locator("#conteudo label:has(input[type=radio])");
    const n = await rotulos.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) expect((await rotulos.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  });
});

test.describe("foco e grades", () => {
  test("celular (iPhone): ao focar um campo baixo, ele vai pro meio da área visível acima do teclado", async ({ page }, info) => {
    test.skip(!ehMobile(info.project.name), "só no celular");
    await abrir(page, "local-novo");
    await page.evaluate(() => {
      const vv = window.visualViewport!;
      Object.defineProperty(vv, "height", { get: () => 520, configurable: true });
      Object.defineProperty(vv, "offsetTop", { get: () => 0, configurable: true });
      vv.dispatchEvent(new Event("resize"));
    });
    const campo = page.locator("#localform-cidade");
    await campo.scrollIntoViewIfNeeded();
    await rolarAoFim(page); // campo fica no pé da tela
    await campo.focus();
    await page.waitForTimeout(1200);
    const b = (await campo.boundingBox())!;
    const centro = b.y + b.height / 2;
    expect(centro).toBeGreaterThan(520 / 2 - 60);
    expect(centro).toBeLessThan(520 / 2 + 60);
  });
  test("celular: campos lado a lado viram 1 coluna (período do envio); desktop segue em 2", async ({ page }, info) => {
    await abrir(page, "envio-novo");
    const de = (await page.locator("#page-periodo-de").boundingBox())!;
    const ate = (await page.locator("#page-periodo-ate").boundingBox())!;
    if (ehMobile(info.project.name)) {
      expect(Math.abs(de.x - ate.x)).toBeLessThan(2);
      expect(ate.y).toBeGreaterThan(de.y + de.height - 1);
    } else {
      expect(ate.x).toBeGreaterThan(de.x + de.width - 1);
      expect(Math.abs(de.y - ate.y)).toBeLessThan(2);
    }
  });
});
