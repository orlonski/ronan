import { describe, expect, it } from "vitest";
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

/**
 * A varredura que impede o bug de fuso de voltar.
 *
 * `new Date().toISOString().slice(0, 10)` é "hoje em UTC", e o container, o
 * navegador do escritório e o celular do motorista não estão em UTC — estão
 * no Brasil. Das 21h à meia-noite, esse atalho devolve AMANHÃ.
 *
 * Não é hipótese: em 19/09/2026 uma alocação de obra criada às 21h nasceu
 * começando no dia seguinte, o motorista somou a diária no mesmo dia, o
 * servidor recusou com "esse dia é anterior ao início na obra" e o item
 * travou no outbox dele — com a tela do app verde, mentindo. Depois disso a
 * mesma linha apareceu em mais oito lugares: pedido, preço, conta a pagar,
 * "está atrasada?", programação (painel e app), baixa de mensalidade, link de
 * documentos e as pastas do bucket.
 *
 * Cada app tem o seu jeito certo, e é sempre um helper:
 * - api ......... `inicioDoDiaData()` / `ymdSaoPaulo()` (common/timezone.ts)
 * - dashboard ... `hojeSP()` (lib/datetime-br.ts)
 * - motorista ... `hojeISO()` (lib/datetime.ts)
 *
 * ⚠️ O que este teste NÃO proíbe: `algumaData.toISOString().slice(0, 10)` em
 * cima de um `Date` que veio do banco. Coluna `@db.Date` chega como meia-noite
 * UTC e já está no dia certo — ancorar em São Paulo ali faria VOLTAR um dia.
 * A regra é sobre `new Date()`, o agora.
 *
 * Mora no `apps/api` porque é o único pacote com runner de teste, e varre os
 * três apps de propósito: a linha errada nasce mais no painel e no app do que
 * aqui.
 */

const RAIZ = resolve(__dirname, "../../../..");

const ALVOS = [
  "apps/api/src",
  "apps/dashboard/src",
  "apps/motorista-app/app",
  "apps/motorista-app/components",
  "apps/motorista-app/lib",
  "apps/motorista-app/hooks",
  "packages/shared-types/src",
];

/**
 * Os próprios helpers, que citam a linha errada na documentação pra explicar
 * por que ela é errada. É o único lugar onde ela pode aparecer.
 */
const LIBERADOS = [
  "apps/api/src/common/timezone.ts",
  "apps/dashboard/src/lib/datetime-br.ts",
  "apps/motorista-app/lib/datetime.ts",
];

/** "hoje" em UTC, nas grafias que já apareceram no repositório. */
const PROIBIDO = [
  /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/,
  /new Date\(\)\s*\.toISOString\(\)\s*\.split\(\s*["']T["']\s*\)\s*\[\s*0\s*\]/,
  /new Date\(\)\s*\.toISOString\(\)\s*\.substring\(\s*0\s*,\s*10\s*\)/,
];

function arquivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === "dist" || nome === ".next") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out.push(...arquivos(caminho));
    else if (/\.(ts|tsx)$/.test(nome) && !nome.endsWith(".spec.ts")) out.push(caminho);
  }
  return out;
}

describe("nenhum 'hoje' calculado em UTC", () => {
  it("não existe `new Date().toISOString()` virando dia em nenhum app", () => {
    const achados: string[] = [];

    for (const alvo of ALVOS) {
      const dir = join(RAIZ, alvo);
      // Pasta ausente não reprova: um build isolado da api não tem os outros
      // apps por perto, e falhar aí seria alarme falso.
      for (const arquivo of arquivos(dir)) {
        const rel = relative(RAIZ, arquivo).split("\\").join("/");
        if (LIBERADOS.includes(rel)) continue;
        const linhas = readFileSync(arquivo, "utf-8").split("\n");
        linhas.forEach((linha, i) => {
          if (PROIBIDO.some((re) => re.test(linha))) {
            achados.push(`${rel}:${i + 1}`);
          }
        });
      }
    }

    expect(
      achados,
      `"hoje" em UTC devolve AMANHÃ das 21h à meia-noite no Brasil.\n` +
        `Use o helper do app: inicioDoDiaData() na api, hojeSP() no painel, hojeISO() no motorista-app.\n` +
        achados.join("\n"),
    ).toEqual([]);
  });
});
