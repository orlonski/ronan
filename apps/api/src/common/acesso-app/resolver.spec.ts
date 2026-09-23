import { describe, expect, it } from "vitest";
import type { CamadaCorte } from "@ronan/shared-types";
import {
  resolverAcessoApp,
  type ContaAcessoCtx,
  type ExcecaoAcessoCtx,
  type PerfilAcessoCtx,
  type PessoaAcesso,
  type RegraAcessoCtx,
} from "./resolver";

/**
 * O CÁLCULO DO ACESSO DO APP.
 *
 * Cada teste aqui é uma frase que o dono precisa poder repetir sem medo:
 * "exceção nunca fura contrato", "desligar perfil não tira acesso de
 * ninguém", "em sombra nada é cortado". Se um desses quebrar, o painel
 * passa a explicar uma coisa e o app fazer outra.
 */

const AGORA = new Date("2026-09-22T12:00:00Z");

const perfil = (id: string, capacidades: string[], ativo = true): PerfilAcessoCtx => ({
  id,
  nome: `Perfil ${id}`,
  ativo,
  capacidades,
});

function conta(
  p: Partial<Omit<ContaAcessoCtx, "perfis">> & { perfis?: PerfilAcessoCtx[] } = {},
): ContaAcessoCtx {
  const perfis = p.perfis ?? [
    perfil("frete", ["app.viagem.lancar", "app.pedagio.lancar", "app.chat.usar", "app.acertos.ver"]),
    perfil("registrado", ["app.ponto.bater", "app.ponto.espelho", "app.viagem.lancar"]),
  ];
  return {
    modulos: p.modulos ?? new Set(["operacao", "comunicacao", "financeiro", "ponto", "conferencia"]),
    rolloutsApp: p.rolloutsApp ?? new Set(),
    perfis: new Map(perfis.map((x) => [x.id, x])),
    regras: p.regras ?? [],
    perfilPadraoMotoristaId: p.perfilPadraoMotoristaId === undefined ? "frete" : p.perfilPadraoMotoristaId,
    perfilPadraoFuncionarioId:
      p.perfilPadraoFuncionarioId === undefined ? "registrado" : p.perfilPadraoFuncionarioId,
    camadasEmSombra: p.camadasEmSombra ?? new Set<CamadaCorte>(),
  };
}

function motorista(p: Partial<NonNullable<PessoaAcesso["motorista"]>> = {}): PessoaAcesso["motorista"] {
  return {
    id: "m1",
    ativo: true,
    aprovado: true,
    modalidadeId: null,
    transportadoraId: null,
    perfilFixadoId: null,
    ...p,
  };
}

function pessoa(p: Partial<PessoaAcesso> = {}): PessoaAcesso {
  return { cpf: "12345678901", regime: null, motorista: motorista(), funcionario: null, ...p };
}

const regra = (r: Partial<RegraAcessoCtx> & { perfilId: string }): RegraAcessoCtx => ({
  id: `r-${r.perfilId}-${r.ordem ?? 1}`,
  ordem: 1,
  nome: "regra",
  ativo: true,
  vinculo: "QUALQUER",
  regime: "QUALQUER",
  modalidadeId: null,
  transportadoraId: null,
  ...r,
});

const excecao = (e: Partial<ExcecaoAcessoCtx> & Pick<ExcecaoAcessoCtx, "capacidade" | "efeito">): ExcecaoAcessoCtx => ({
  id: `e-${e.capacidade}`,
  motivo: "motivo de teste",
  expiraEm: null,
  revogadaEm: null,
  ...e,
});

describe("base: fixado → regra → padrão", () => {
  it("sem regra, o motorista cai no padrão da empresa", () => {
    const r = resolverAcessoApp(pessoa(), conta(), [], AGORA);
    expect(r.base.motorista).toMatchObject({ perfilId: "frete", via: "PADRAO" });
    expect(r.efetivo).toContain("app.viagem.lancar");
  });

  it("a primeira regra que casa vence, na ordem", () => {
    const c = conta({
      perfis: [perfil("frete", ["app.viagem.lancar"]), perfil("agregado", ["app.pedagio.lancar"]), perfil("outro", [])],
      regras: [
        regra({ perfilId: "outro", ordem: 2 }),
        regra({ perfilId: "agregado", ordem: 1, modalidadeId: "mod-agregado" }),
      ],
    });
    const r = resolverAcessoApp(pessoa({ motorista: motorista({ modalidadeId: "mod-agregado" }) }), c, [], AGORA);
    expect(r.base.motorista).toMatchObject({ perfilId: "agregado", via: "REGRA" });
    expect(r.efetivo).toEqual(["app.pedagio.lancar"]);
  });

  it("perfil fixado pula as regras", () => {
    const c = conta({ regras: [regra({ perfilId: "registrado" })] });
    const r = resolverAcessoApp(pessoa({ motorista: motorista({ perfilFixadoId: "frete" }) }), c, [], AGORA);
    expect(r.base.motorista?.via).toBe("FIXADO");
  });

  it("regra por regime: CLT cai no perfil de registrado", () => {
    const c = conta({
      perfis: [perfil("frete", ["app.acertos.ver"]), perfil("clt-dirige", ["app.viagem.lancar"])],
      regras: [regra({ perfilId: "clt-dirige", regime: "EMPREGADO" })],
    });
    expect(resolverAcessoApp(pessoa({ regime: "EMPREGADO" }), c, [], AGORA).base.motorista?.perfilId).toBe(
      "clt-dirige",
    );
    expect(resolverAcessoApp(pessoa({ regime: null }), c, [], AGORA).base.motorista?.perfilId).toBe("frete");
  });

  it("NAO_DECLARADO só casa com quem não tem regime", () => {
    const c = conta({ regras: [regra({ perfilId: "registrado", regime: "NAO_DECLARADO" })] });
    expect(resolverAcessoApp(pessoa(), c, [], AGORA).base.motorista?.via).toBe("REGRA");
    expect(resolverAcessoApp(pessoa({ regime: "PARCEIRO" }), c, [], AGORA).base.motorista?.via).toBe("PADRAO");
  });

  it("regra por modalidade não alcança o funcionário por omissão", () => {
    const c = conta({ regras: [regra({ perfilId: "frete", modalidadeId: "x", vinculo: "QUALQUER" })] });
    const r = resolverAcessoApp(
      pessoa({ motorista: null, funcionario: { id: "f1", ativo: true, perfilFixadoId: null } }),
      c,
      [],
      AGORA,
    );
    expect(r.base.funcionario?.via).toBe("PADRAO");
  });

  it("regra apontando pra perfil desligado passa pra próxima — desligar perfil não tira acesso", () => {
    const c = conta({
      perfis: [perfil("frete", ["app.viagem.lancar"]), perfil("velho", [], false)],
      regras: [regra({ perfilId: "velho" })],
    });
    const r = resolverAcessoApp(pessoa(), c, [], AGORA);
    expect(r.base.motorista?.perfilId).toBe("frete");
    expect(r.efetivo).toContain("app.viagem.lancar");
  });

  it("sem padrão e sem regra, não tem nada", () => {
    const r = resolverAcessoApp(pessoa(), conta({ perfilPadraoMotoristaId: null }), [], AGORA);
    expect(r.efetivo).toEqual([]);
  });
});

describe("vínculo: capacidade mora num cadastro", () => {
  it("o CLT sem cadastro de motorista não lança viagem, mesmo que o perfil tenha", () => {
    const r = resolverAcessoApp(
      pessoa({ motorista: null, funcionario: { id: "f1", ativo: true, perfilFixadoId: null } }),
      conta(),
      [],
      AGORA,
    );
    expect(r.efetivo).toEqual(["app.ponto.bater", "app.ponto.espelho"]);
    expect(r.explicacao["app.viagem.lancar"]!.ligado).toBe(false);
  });

  it("exceção não cria vínculo: conceder ponto a quem não é registrado não faz nada", () => {
    const r = resolverAcessoApp(
      pessoa(),
      conta(),
      [excecao({ capacidade: "app.ponto.bater", efeito: "CONCEDER" })],
      AGORA,
    );
    expect(r.efetivo).not.toContain("app.ponto.bater");
    expect(r.explicacao["app.ponto.bater"]!.cortes[0]).toMatchObject({ camada: "VINCULO", sombra: false });
  });

  it("quem tem os dois cadastros recebe SÓ o tipo do motorista (decisão do dono, 22/09/2026)", () => {
    // Antes somava os dois perfis. Agora uma pessoa tem um tipo: o do motorista,
    // que cobre também o ponto (se o tipo tiver). "frete" não tem ponto.
    const r = resolverAcessoApp(
      pessoa({ funcionario: { id: "f1", ativo: true, perfilFixadoId: null } }),
      conta(),
      [],
      AGORA,
    );
    expect(r.efetivo).toEqual(expect.arrayContaining(["app.viagem.lancar", "app.chat.usar"]));
    expect(r.efetivo).not.toContain("app.ponto.bater");
  });
});

describe("exceções", () => {
  it("concede o que o perfil não dá", () => {
    const r = resolverAcessoApp(pessoa(), conta(), [excecao({ capacidade: "app.km.referencia", efeito: "CONCEDER" })], AGORA);
    expect(r.efetivo).toContain("app.km.referencia");
    expect(r.explicacao["app.km.referencia"]!.origem).toMatchObject({ tipo: "EXCECAO" });
  });

  it("nega o que o perfil dá, e negar vence conceder", () => {
    const r = resolverAcessoApp(
      pessoa(),
      conta(),
      [
        excecao({ id: "a", capacidade: "app.chat.usar", efeito: "CONCEDER" }),
        excecao({ id: "b", capacidade: "app.chat.usar", efeito: "NEGAR" }),
      ],
      AGORA,
    );
    expect(r.efetivo).not.toContain("app.chat.usar");
  });

  it("vencida ou revogada não vale", () => {
    const r = resolverAcessoApp(
      pessoa(),
      conta(),
      [
        excecao({ capacidade: "app.km.referencia", efeito: "CONCEDER", expiraEm: new Date("2026-09-01") }),
        excecao({ capacidade: "app.chat.usar", efeito: "NEGAR", revogadaEm: new Date("2026-09-01") }),
      ],
      AGORA,
    );
    expect(r.efetivo).not.toContain("app.km.referencia");
    expect(r.efetivo).toContain("app.chat.usar");
  });

  it("a próxima mudança é a exceção viva que vence primeiro", () => {
    const d1 = new Date("2026-10-01");
    const d2 = new Date("2026-11-01");
    const r = resolverAcessoApp(
      pessoa(),
      conta(),
      [
        excecao({ id: "a", capacidade: "app.km.referencia", efeito: "CONCEDER", expiraEm: d2 }),
        excecao({ id: "b", capacidade: "app.locais.verTodos", efeito: "CONCEDER", expiraEm: d1 }),
      ],
      AGORA,
    );
    expect(r.proximaMudanca).toEqual(d1);
  });
});

describe("cortes e sombra", () => {
  it("exceção nunca fura contrato", () => {
    const r = resolverAcessoApp(
      pessoa(),
      conta({ modulos: new Set(["operacao"]) }),
      [excecao({ capacidade: "app.chat.usar", efeito: "CONCEDER" })],
      AGORA,
    );
    expect(r.efetivo).not.toContain("app.chat.usar");
    expect(r.explicacao["app.chat.usar"]!.cortes).toEqual([
      expect.objectContaining({ camada: "CONTRATO", sombra: false }),
    ]);
  });

  it("em SOMBRA o contrato só avisa: o acesso continua, e a sombra mostra quem perderia", () => {
    const r = resolverAcessoApp(
      pessoa(),
      conta({ modulos: new Set(["operacao"]), camadasEmSombra: new Set(["CONTRATO"]) }),
      [],
      AGORA,
    );
    expect(r.efetivo).toContain("app.chat.usar");
    expect(r.sombra).not.toContain("app.chat.usar");
    expect(r.explicacao["app.chat.usar"]!.cortes[0]).toMatchObject({ camada: "CONTRATO", sombra: true });
  });

  it("empregado não recebe acerto — com a camada ligada", () => {
    const r = resolverAcessoApp(pessoa({ regime: "EMPREGADO" }), conta(), [], AGORA);
    expect(r.efetivo).not.toContain("app.acertos.ver");
    expect(r.efetivo).toContain("app.viagem.lancar"); // CLT que dirige lança, se o perfil deixar
  });

  it("empregado com acerto em SOMBRA continua com ele, e aparece no relatório", () => {
    const r = resolverAcessoApp(
      pessoa({ regime: "EMPREGADO" }),
      conta({ camadasEmSombra: new Set(["REGIME"]) }),
      [],
      AGORA,
    );
    expect(r.efetivo).toContain("app.acertos.ver");
    expect(r.sombra).not.toContain("app.acertos.ver");
  });

  it("cadastro não aprovado perde o que é de motorista", () => {
    const r = resolverAcessoApp(pessoa({ motorista: motorista({ aprovado: false }) }), conta(), [], AGORA);
    expect(r.efetivo).toEqual([]);
  });

  it("rollout não liberado na empresa corta; liberado passa", () => {
    const c = (rollouts: string[]) =>
      conta({ perfis: [perfil("frete", ["app.viagem.lancar", "app.viagem.guiada"])], rolloutsApp: new Set(rollouts) });
    expect(resolverAcessoApp(pessoa(), c([]), [], AGORA).efetivo).not.toContain("app.viagem.guiada");
    expect(resolverAcessoApp(pessoa(), c(["app.viagem.guiada"]), [], AGORA).efetivo).toContain(
      "app.viagem.guiada",
    );
  });

  it("espelho do ponto sobrevive ao cancelamento do módulo", () => {
    const r = resolverAcessoApp(
      pessoa({ motorista: null, funcionario: { id: "f1", ativo: true, perfilFixadoId: null } }),
      conta({ modulos: new Set(["operacao"]) }),
      [],
      AGORA,
    );
    expect(r.efetivo).toEqual(["app.ponto.espelho"]);
  });
});

describe("dependências", () => {
  const c = (sombra: CamadaCorte[] = []) =>
    conta({
      perfis: [perfil("frete", ["app.viagem.guiada", "app.ticket.ocr"])],
      rolloutsApp: new Set(["app.viagem.guiada"]),
      camadasEmSombra: new Set(sombra),
    });

  it("guiada sem lançar viagem cai, e o OCR cai junto (cadeia)", () => {
    const r = resolverAcessoApp(pessoa(), c(), [], AGORA);
    expect(r.efetivo).toEqual([]);
    expect(r.explicacao["app.viagem.guiada"]!.cortes).toEqual([
      expect.objectContaining({ camada: "DEPENDENCIA", sombra: false }),
    ]);
  });

  it("em sombra, a dependência só avisa", () => {
    const r = resolverAcessoApp(pessoa(), c(["DEPENDENCIA"]), [], AGORA);
    expect(r.efetivo).toEqual(["app.viagem.guiada", "app.ticket.ocr"]);
    expect(r.sombra).toEqual([]);
  });
});

describe("com todas as camadas de hoje em sombra, o cálculo é o perfil", () => {
  it("não corta nada que o perfil dá (a garantia do dia 1)", () => {
    const tudo = conta({
      perfis: [perfil("frete", ["app.viagem.guiada", "app.chat.usar", "app.acertos.ver", "app.telemetria"])],
      modulos: new Set(["operacao"]),
      camadasEmSombra: new Set(["DEPENDENCIA", "REGIME", "PLATAFORMA", "CONTRATO"]),
    });
    const r = resolverAcessoApp(pessoa({ regime: "EMPREGADO" }), tudo, [], AGORA);
    expect(r.efetivo).toEqual(["app.viagem.guiada", "app.acertos.ver", "app.chat.usar", "app.telemetria"]);
    expect(r.sombra).toEqual([]);
  });
});

describe("uma pessoa, um tipo: o motorista CLT recebe só o tipo do motorista", () => {
  /**
   * Quem tem cadastro de motorista recebe o perfil do tipo dele (modalidade
   * ou "sem modalidade") e SÓ ele — inclusive o ponto, se for CLT. Se somasse
   * o "só bate ponto", desmarcar "Bater ponto" na coluna dele não tiraria nada.
   */
  const perfis = [
    perfil("frete", ["app.viagem.lancar", "app.acertos.ver", "app.ponto.bater"]),
    perfil("registrado", ["app.ponto.bater", "app.ponto.espelho"]),
  ];
  const ctx = conta({ perfis });
  const funcionario = { id: "f1", ativo: true, perfilFixadoId: null };

  it("recebe exatamente o tipo do motorista, com o ponto que está nele", () => {
    const r = resolverAcessoApp(pessoa({ funcionario }), ctx, [], AGORA);
    expect([...r.efetivo].sort()).toEqual(["app.acertos.ver", "app.ponto.bater", "app.viagem.lancar"]);
  });

  it("o que só está no 'só bate ponto' não vem junto", () => {
    const r = resolverAcessoApp(pessoa({ funcionario, regime: "EMPREGADO" }), ctx, [], AGORA);
    expect(r.efetivo).not.toContain("app.ponto.espelho");
  });

  it("o ponto do tipo do motorista só vale pra quem é funcionário (estrutural)", () => {
    const r = resolverAcessoApp(pessoa(), ctx, [], AGORA);
    expect(r.efetivo).not.toContain("app.ponto.bater");
  });

  it("quem só é funcionário recebe o 'só bate ponto'", () => {
    const r = resolverAcessoApp(pessoa({ motorista: null, funcionario }), ctx, [], AGORA);
    expect([...r.efetivo].sort()).toEqual(["app.ponto.bater", "app.ponto.espelho"]);
  });

  it("diferença só dele continua valendo por cima do tipo", () => {
    const ex = [{ id: "e1", capacidade: "app.ponto.espelho", efeito: "CONCEDER" as const, motivo: "m", expiraEm: null, revogadaEm: null }];
    const r = resolverAcessoApp(pessoa({ funcionario, regime: "EMPREGADO" }), ctx, ex, AGORA);
    expect(r.efetivo).toContain("app.ponto.espelho");
  });
});
