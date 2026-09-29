import { test, abrirRota, expect } from "./ambiente";
import { medir } from "./medidas";
import { comparar, entradaDe, gravarEntrada, lerOrcamento } from "./orcamento";
import { ROTAS } from "./rotas";
import type { NomeViewport } from "./viewports";

/**
 * Orçamento de UX (ratchet). Ver tests/ux/README.md.
 *  - piorou qualquer número contra tests/ux/orcamento.json  -> FALHA
 *  - melhorou                                                -> passa e imprime "melhorou, atualize o orçamento"
 *  - UX_ATUALIZAR=1 (pnpm ux:orcamento:atualizar / ux:ultra:atualizar) regrava a entrada medida
 */
const ATUALIZAR = process.env.UX_ATUALIZAR === "1";

for (const rota of ROTAS) {
  test(`orçamento: ${rota.id}`, async ({ page }, info) => {
    const vp = info.project.name as NomeViewport;
    await abrirRota(page, rota);
    const m = await medir(page);

    if (ATUALIZAR) {
      gravarEntrada(rota.id, vp, entradaDe(m));
      console.log(`[ux] orçamento regravado: ${rota.id} @ ${vp}`);
      return;
    }

    const orc = lerOrcamento().rotas[rota.id]?.[vp];
    expect(orc, `sem orçamento pra ${rota.id} @ ${vp}: rode "pnpm ux:orcamento:atualizar" (ou ux:ultra:atualizar)`).toBeTruthy();
    const v = comparar(m, orc!, vp);

    for (const linha of v.informativo) console.log(`[ux] ${rota.id} @ ${vp}: ${linha}`);
    if (v.melhorou.length) {
      const msg = `melhorou, atualize o orçamento (pnpm ux:orcamento:atualizar): ${v.melhorou.join("; ")}`;
      console.log(`[ux] ${rota.id} @ ${vp}: ${msg}`);
      info.annotations.push({ type: "melhorou", description: msg });
    }
    if (v.piorou.length) {
      const d = m.detalhes;
      const pistas = [
        d.estouram.length ? `estouram: ${JSON.stringify(d.estouram.slice(0, 3))}` : "",
        d.alvosPequenos.length ? `alvos<44: ${JSON.stringify(d.alvosPequenos.slice(0, 3))}` : "",
        d.fontesPequenas.length ? `fontes<14: ${JSON.stringify(d.fontesPequenas.slice(0, 3))}` : "",
        d.inputsPequenos.length ? `inputs<16: ${JSON.stringify(d.inputsPequenos.slice(0, 3))}` : "",
        d.viewportMeta ? `meta viewport: ${d.viewportMeta}` : "",
      ].filter(Boolean);
      throw new Error(`PIOROU ${rota.id} @ ${vp}\n  - ${v.piorou.join("\n  - ")}\n  pistas: ${pistas.join(" | ")}`);
    }
  });
}
