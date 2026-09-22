import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACESSOS_APP_CHAVES,
  CAPACIDADES_APP,
  CATALOGO_PERMISSOES,
  MODULOS_POR_CHAVE,
  type CamadaCorte,
} from "@ronan/shared-types";
import { PADRAO_DO_BANCO } from "./acesso-app.service";
import {
  capacidadesDasColunas,
  capacidadesDoRegistradoHerdado,
  planejarEspelho,
  type ColunasAcesso,
} from "./espelho-colunas";
import { resolverAcessoApp, type ContaAcessoCtx } from "./resolver";

/**
 * O ESPELHO DO CADASTRO e as invariantes do catálogo.
 *
 * A promessa que estes testes seguram: ligar o sistema novo NÃO MUDA NADA pra
 * ninguém. O espelho monta perfil + exceções e o resolvedor, com as camadas
 * que mudariam o presente em sombra, devolve exatamente a ficha de cada um.
 */

const SCHEMA = readFileSync(resolve(__dirname, "../../../prisma/schema.prisma"), "utf8");

function blocoDo(model: string): string {
  return SCHEMA.split(`model ${model} {`)[1]?.split("\n}")[0] ?? "";
}

const todasColunas = (v: boolean): ColunasAcesso =>
  Object.fromEntries(ACESSOS_APP_CHAVES.map((c) => [c, v])) as ColunasAcesso;

describe("catálogo de capacidades", () => {
  it("toda chave começa com app. e não colide com o catálogo do painel", () => {
    const painel = new Set(CATALOGO_PERMISSOES.map((p) => p.chave));
    for (const d of CAPACIDADES_APP) {
      expect(d.chave.startsWith("app.")).toBe(true);
      expect(painel.has(d.chave)).toBe(false);
    }
  });

  it("todo módulo existe", () => {
    expect(CAPACIDADES_APP.filter((d) => !MODULOS_POR_CHAVE[d.modulo]).map((d) => d.chave)).toEqual([]);
  });

  it("toda coluna legada existe no Motorista, e cada coluna tem UM espelho que a escreve", () => {
    const cols = new Set([...blocoDo("Motorista").matchAll(/^\s{2}(\w+)\s+/gm)].map((m) => m[1]));
    const escritores = new Map<string, number>();
    for (const d of CAPACIDADES_APP) {
      if (!d.colunaLegada) continue;
      expect(cols.has(d.colunaLegada.coluna)).toBe(true);
      if (d.colunaLegada.espelha) {
        escritores.set(d.colunaLegada.coluna, (escritores.get(d.colunaLegada.coluna) ?? 0) + 1);
      }
    }
    // Toda coluna pode* tem exatamente uma capacidade que a escreve.
    for (const c of ACESSOS_APP_CHAVES) expect([c, escritores.get(c)]).toEqual([c, 1]);
  });

  it("diária, obra e acertos proíbem EMPREGADO — o guarda-corpo jurídico não some", () => {
    for (const c of ["app.diaria.lancar", "app.diaria.verValor", "app.obra.presenca", "app.acertos.ver"]) {
      expect(CAPACIDADES_APP.find((d) => d.chave === c)?.regimesProibidos).toContain("EMPREGADO");
    }
  });

  it("dependência só aponta pra capacidade que vem ANTES no catálogo (a cadeia resolve numa passada)", () => {
    const pos = new Map(CAPACIDADES_APP.map((d, i) => [d.chave, i]));
    for (const d of CAPACIDADES_APP) {
      for (const dep of d.dependeDe ?? []) expect(pos.get(dep)!).toBeLessThan(pos.get(d.chave)!);
    }
  });

  it("PADRAO_DO_BANCO é o @default das colunas do Motorista", () => {
    const bloco = blocoDo("Motorista");
    for (const c of ACESSOS_APP_CHAVES) {
      const m = bloco.match(new RegExp(`^\\s+${c}\\s+Boolean\\s+@default\\((true|false)\\)`, "m"));
      expect([c, m?.[1]]).toEqual([c, String(PADRAO_DO_BANCO[c])]);
    }
  });
});

describe("espelho do cadastro", () => {
  it("capacidade nova (sem coluna) nasce ligada pra quem é motorista — nada some do celular", () => {
    const caps = capacidadesDasColunas(todasColunas(false));
    expect(caps).toEqual(
      expect.arrayContaining([
        "app.navegacao.aoVivo",
        "app.programacao.ver",
        "app.acertos.ver",
        "app.posicao.compartilhar",
        "app.documentos.enviar",
        "app.obra.presenca",
      ]),
    );
    expect(caps.some((c) => c.startsWith("app.ponto."))).toBe(false);
  });

  it("o padrão é o conjunto mais comum, e só quem difere ganha exceção", () => {
    const base = { ...PADRAO_DO_BANCO };
    const plano = planejarEspelho(
      [
        { id: "a", cpf: "1", perfilAcessoId: null, colunas: base },
        { id: "b", cpf: "2", perfilAcessoId: null, colunas: base },
        { id: "c", cpf: "3", perfilAcessoId: null, colunas: { ...base, podeUsarOcrTicket: true } },
      ],
      [],
      PADRAO_DO_BANCO,
    );
    expect(plano.padrao).toEqual(capacidadesDasColunas(base));
    expect(plano.excecoes).toEqual([{ cpf: "3", capacidade: "app.ticket.ocr", efeito: "CONCEDER" }]);
  });

  it("quem já estava num perfil tem exceção contra o PERFIL dele, não contra o padrão", () => {
    const perfilCols = { ...PADRAO_DO_BANCO, podeChat: false };
    const plano = planejarEspelho(
      [
        { id: "a", cpf: "1", perfilAcessoId: null, colunas: PADRAO_DO_BANCO },
        { id: "b", cpf: "2", perfilAcessoId: "p1", colunas: perfilCols },
      ],
      [{ id: "p1", colunas: perfilCols }],
      PADRAO_DO_BANCO,
    );
    expect(plano.excecoes).toEqual([]);
  });

  it("sem motorista nenhum, o padrão é o do banco", () => {
    const plano = planejarEspelho([], [], PADRAO_DO_BANCO);
    expect(plano.padrao).toEqual(capacidadesDasColunas(PADRAO_DO_BANCO));
  });

  it("o resolvedor reproduz a ficha de TODO MUNDO (o portão, em miniatura)", () => {
    // Uma frota bagunçada de propósito: cada um com uma combinação.
    const motoristas = ACESSOS_APP_CHAVES.map((c, i) => ({
      id: `m${i}`,
      cpf: String(10_000_000_000 + i),
      perfilAcessoId: null,
      colunas: { ...PADRAO_DO_BANCO, [c]: !PADRAO_DO_BANCO[c] },
    }));
    motoristas.push({ id: "igual", cpf: "99999999999", perfilAcessoId: null, colunas: PADRAO_DO_BANCO });
    motoristas.push({ id: "igual2", cpf: "99999999998", perfilAcessoId: null, colunas: PADRAO_DO_BANCO });
    motoristas.push({ id: "tudo", cpf: "99999999997", perfilAcessoId: null, colunas: todasColunas(true) });
    motoristas.push({ id: "nada", cpf: "99999999996", perfilAcessoId: null, colunas: todasColunas(false) });

    const plano = planejarEspelho(motoristas, [], PADRAO_DO_BANCO);
    const ctx: ContaAcessoCtx = {
      // Conta pobre de propósito: sem módulo, sem rollout. Em sombra, nada disso corta.
      modulos: new Set(["operacao"]),
      rolloutsApp: new Set(),
      perfis: new Map([
        ["padrao", { id: "padrao", nome: "p", ativo: true, capacidades: plano.padrao }],
        ["reg", { id: "reg", nome: "r", ativo: true, capacidades: capacidadesDoRegistradoHerdado() }],
      ]),
      regras: [],
      perfilPadraoMotoristaId: "padrao",
      perfilPadraoFuncionarioId: "reg",
      camadasEmSombra: new Set<CamadaCorte>(["DEPENDENCIA", "REGIME", "PLATAFORMA", "CONTRATO"]),
    };
    for (const m of motoristas) {
      const ex = plano.excecoes
        .filter((e) => e.cpf === m.cpf)
        .map((e) => ({ id: e.capacidade, capacidade: e.capacidade, efeito: e.efeito, motivo: "x", expiraEm: null, revogadaEm: null }));
      const r = resolverAcessoApp(
        {
          cpf: m.cpf,
          regime: "EMPREGADO", // o pior caso: com REGIME ligado, diária cairia
          motorista: { id: m.id, ativo: true, aprovado: true, modalidadeId: null, transportadoraId: null, perfilFixadoId: null },
          funcionario: null,
        },
        ctx,
        ex,
        new Date(),
      );
      expect([m.id, r.efetivo]).toEqual([m.id, plano.desejado.get(m.id)]);
    }
  });
});
