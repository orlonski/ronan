import { test, abrirRota, expect } from "./ambiente";
import { medir } from "./medidas";
import { comparar, entradaDe } from "./orcamento";
import { ROTAS } from "./rotas";
import type { NomeViewport } from "./viewports";

/**
 * Teste de sanidade da própria trava: se estourarmos o layout de propósito (width: 4000px no
 * <main>), o orçamento TEM que acusar piora. Verde aqui = a trava funciona. Se ficar vermelho,
 * o orçamento deixou de enxergar overflow e não protege mais nada.
 * (Pra ver a suíte inteira vermelha: UX_SABOTAR=1 pnpm ux — ver README.)
 */
test("a trava acusa layout estourado", async ({ page }, info) => {
  const vp = info.project.name as NomeViewport;
  const rota = ROTAS.find((r) => r.id === "viagens")!;
  await abrirRota(page, rota);
  const limpo = await medir(page);
  const orc = entradaDe(limpo); // teto = a medida limpa desta mesma execução
  expect(comparar(limpo, orc, vp).piorou, "sem sabotagem não pode piorar").toEqual([]);

  await page.addStyleTag({ content: "#conteudo{width:4000px !important;min-width:4000px !important}" });
  await page.waitForTimeout(300);
  const estourado = await medir(page);
  const v = comparar(estourado, orc, vp);
  expect(v.piorou.length, `a sabotagem de 4000px não foi detectada: ${JSON.stringify(estourado)}`).toBeGreaterThan(0);
});
