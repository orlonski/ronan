import { test, abrirRota, estabilizar, expect } from "./ambiente";
import { ROTAS } from "./rotas";

/**
 * Baseline VISUAL do ultrawide (3440x1440): a trava de "não piorar o ultrawide".
 * Só roda no projeto `ultra` (ver playwright.config.ts). Screenshot só do viewport, em
 * tests/ux/baseline/ultra/. Tolerância: até 0,3% dos pixels diferentes (maxDiffPixelRatio) —
 * cobre serrilhado de fonte, mas não deixa passar menu, coluna ou espaçamento que mudou.
 * Regravar (de propósito): pnpm ux:ultra:atualizar
 */
for (const rota of ROTAS) {
  test(`ultrawide: ${rota.id}`, async ({ page }) => {
    await abrirRota(page, rota);
    await estabilizar(page);
    await expect(page).toHaveScreenshot(`${rota.id}.png`, {
      fullPage: false,
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.003,
      threshold: 0.2,
    });
  });
}
