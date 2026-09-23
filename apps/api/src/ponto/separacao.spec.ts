import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * A SEPARAÇÃO ENTRE PARCEIRO E EMPREGADO, cobrada por teste.
 *
 * O parceiro autônomo é pago por produção (acerto); `ponto` é empregado
 * registrado com jornada. Somar as duas coisas na mesma pessoa desenha os
 * elementos de vínculo dentro do produto, e quem paga essa conta é a
 * transportadora.
 *
 * A trava real está no banco (`RegimeVigente`). Este teste protege a outra
 * metade: o código de um módulo não pode começar a chamar o do outro, porque
 * é assim que duas coisas separadas viram uma só sem ninguém decidir isso.
 *
 * ⚠️ NÃO proíbe infra compartilhada. Prisma, guards, pipes, timezone e
 * shared-types são importados pelos dois e não há como escrever um controller
 * Nest sem eles — um teste que proibisse tudo seria ruído que alguém desliga
 * na primeira semana, e a trava real se perderia junto.
 */

const RAIZ = resolve(__dirname, "..");

/**
 * O que é DOMÍNIO do parceiro e não pode atravessar pro ponto. (O módulo de
 * obra e diária, que era o outro lado desta cerca, saiu em 22/09/2026.)
 */
const DOMINIO_PARCEIRO = ["common/acerto-motorista", "common/pedido-saldo"];

function arquivosDe(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out.push(...arquivosDe(caminho));
    else if (nome.endsWith(".ts") && !nome.endsWith(".spec.ts")) out.push(caminho);
  }
  return out;
}

/** Só as linhas de import, sem comentário — prosa pode citar o outro módulo. */
function importsDe(arquivo: string): string[] {
  const codigo = readFileSync(arquivo, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return [...codigo.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("ponto e pagamento do parceiro não se misturam", () => {
  it("nada em src/ponto/ importa domínio do parceiro", () => {
    const vazamentos: string[] = [];
    for (const arquivo of arquivosDe(join(RAIZ, "ponto"))) {
      for (const imp of importsDe(arquivo)) {
        if (DOMINIO_PARCEIRO.some((d) => imp.includes(d))) {
          vazamentos.push(`${arquivo}: ${imp}`);
        }
      }
    }
    expect(vazamentos).toEqual([]);
  });

  it("cadastrar motorista pode MOSTRAR o regime, nunca decidir com ele", () => {
    /**
     * ⚠️ O caso que este teste protege é o MAIS COMUM de quem compra o ponto:
     * o motorista CLT da própria transportadora, que lança viagem E bate
     * ponto no mesmo dia. Ele precisa dos DOIS cadastros — `Motorista` e
     * `Funcionario` — e `auth/types.ts` diz isso com todas as letras.
     *
     * A exclusividade do `RegimeVigente` é entre PAGAMENTO POR PRODUÇÃO e
     * PONTO, não entre os dois cadastros. Já recusei cadastro de motorista por existir
     * vínculo de emprego no mesmo CPF: passou em todos os 1615 testes e
     * teria trancado a porta do caso principal em produção. Ninguém
     * descobriria pelo código — só pelo cliente não conseguindo cadastrar o
     * próprio motorista.
     */
    const alvo = resolve(RAIZ, "admin/motoristas/motoristas.service.ts");
    const codigo = readFileSync(alvo, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    // `regimeDe` é consulta: devolve o regime e não sabe recusar nada. As
    // outras três ABREM, ENCERRAM ou RESPONDEM SIM/NÃO pra barrar — é com
    // elas que se tranca uma porta, e nenhuma tem o que fazer aqui.
    for (const proibida of ["temVinculoDeEmprego", "abrirRegime", "encerrarRegime"]) {
      expect(codigo.includes(proibida), `cadastro de motorista usa ${proibida}`).toBe(false);
    }
  });

  it("a trava de regime fala de regime e parceiro, nunca de jornada", () => {
    const proibidas = /\b(ponto|jornada|hora ?extra|falta[sr]?|atraso|escala|expediente)\b/i;
    const trava = readFileSync(join(RAIZ, "common/regime-vigente.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(proibidas.test(trava)).toBe(false);
  });
});
