import { describe, expect, it } from "vitest";
import {
  CHAVES_PLATAFORMA,
  MODULOS,
  PERMISSOES_ADMIN_EMPRESA,
  TODAS_AS_CHAVES,
} from "@ronan/shared-types";
import { acimaDoTeto, modulosDaConta, tetoDaConta } from "./teto-da-conta";

/** Todos os módulos ligados, sem vigência — o estado depois da migração. */
const TODOS_MODULOS = MODULOS.map((m) => ({
  chave: m.chave,
  vigenteDe: null as Date | null,
  vigenteAte: null as Date | null,
}));

/**
 * Prisma de mentira: a conta e o teto padrão que o teste quiser.
 *
 * `padrao: null` = a linha de configuração ainda não foi semeada, que é o estado
 * de um banco antes do primeiro boot com o recurso.
 */
function prismaCom(
  conta: { ehPlataforma: boolean; permissoesPermitidas: string[]; permissoesExtras?: string[] } | null,
  padrao: string[] | null = null,
  modulos: { chave: string; vigenteDe: Date | null; vigenteAte: Date | null }[] = TODOS_MODULOS,
) {
  return {
    conta: { findUnique: async () => conta },
    configuracaoPermissoes: {
      findUnique: async () =>
        padrao === null ? null : { tetoPadrao: padrao, semeado: true },
    },
    moduloContratado: { findMany: async () => modulos },
  };
}

describe("tetoDaConta", () => {
  it("a casa concede o catálogo inteiro", async () => {
    const teto = await tetoDaConta(prismaCom({ ehPlataforma: true, permissoesPermitidas: [] }), "x");
    expect(teto.size).toBe(TODAS_AS_CHAVES.length);
  });

  it("empresa sem customização cai no padrão de antes do teto existir", async () => {
    // É o que garante que a migration não mudou o comportamento de ninguém:
    // toda empresa nasce com a lista vazia.
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: [] }),
      "x",
    );
    expect([...teto].sort()).toEqual([...PERMISSOES_ADMIN_EMPRESA].sort());
  });

  it("empresa sem customização não recebe nenhuma chave de plataforma", async () => {
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: [] }),
      "x",
    );
    for (const chave of CHAVES_PLATAFORMA) expect(teto.has(chave)).toBe(false);
  });

  it("lista preenchida vale exatamente como está — inclusive liberando o que é de plataforma", async () => {
    // O caso de uso do teto: a plataforma abrir uma tela pra um cliente
    // específico. Se a lista não pudesse conter chave de plataforma, o recurso
    // não serviria pra nada.
    const liberada = CHAVES_PLATAFORMA[0]!;
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: ["viagens.ver", liberada] }),
      "x",
    );
    expect([...teto].sort()).toEqual(["viagens.ver", liberada].sort());
  });

  it("extras somam ao padrão sem congelá-lo", async () => {
    // O padrão continua vindo do banco: chave que entrar nele amanhã chega
    // também a quem tem extra.
    const extra = CHAVES_PLATAFORMA[0]!;
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: [], permissoesExtras: [extra] }, [
        "viagens.ver",
        "torre.ver",
      ]),
      "x",
    );
    expect([...teto].sort()).toEqual(["viagens.ver", "torre.ver", extra].sort());
  });

  it("lista própria preenchida ignora as extras (ela já diz tudo)", async () => {
    const teto = await tetoDaConta(
      prismaCom({
        ehPlataforma: false,
        permissoesPermitidas: ["viagens.ver"],
        permissoesExtras: ["torre.ver"],
      }),
      "x",
    );
    expect([...teto]).toEqual(["viagens.ver"]);
  });

  it("chave que saiu do catálogo não volta à vida por estar guardada no banco", async () => {
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: ["viagens.ver", "modulo.extinto"] }),
      "x",
    );
    expect(teto.has("modulo.extinto")).toBe(false);
    expect(teto.has("viagens.ver")).toBe(true);
  });

  it("conta que não existe cai no padrão, nunca no catálogo inteiro", async () => {
    // Fail-closed: some a conta, some o poder — não o contrário.
    const teto = await tetoDaConta(prismaCom(null), "sumiu");
    expect([...teto].sort()).toEqual([...PERMISSOES_ADMIN_EMPRESA].sort());
  });

  it("o teto padrão vem do BANCO, não da constante — é ele que manda", async () => {
    // O ponto do recurso: abrir ou fechar uma tela pra todos os clientes é
    // decisão de tela. Aqui o padrão configurado libera uma chave de plataforma
    // e restringe o resto; a constante não tem mais voz.
    const liberada = CHAVES_PLATAFORMA[0]!;
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: [] }, ["viagens.ver", liberada]),
      "x",
    );
    expect([...teto].sort()).toEqual(["viagens.ver", liberada].sort());
  });

  it("teto da empresa vence o padrão", async () => {
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: ["locais.ver"] }, ["viagens.ver"]),
      "x",
    );
    expect([...teto]).toEqual(["locais.ver"]);
  });

  it("padrão configurado como lista vazia significa vazio de verdade", async () => {
    // Diferente de "nunca configurado": se a plataforma decidiu que empresa
    // nenhuma concede nada por padrão, isso tem que valer.
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: [] }, []),
      "x",
    );
    expect(teto.size).toBe(0);
  });
});

describe("acimaDoTeto", () => {
  it("aponta só o que passa do teto", () => {
    const teto = new Set(["a", "b"]);
    expect(acimaDoTeto(["a", "c", "d"], teto)).toEqual(["c", "d"]);
  });

  it("nada acima do teto devolve lista vazia", () => {
    expect(acimaDoTeto(["a"], new Set(["a", "b"]))).toEqual([]);
  });
});


describe("módulos contratados", () => {
  it("o núcleo vale mesmo sem nenhuma linha contratada", async () => {
    // Conta criada antes do módulo existir, ou seed que falhou: precisa
    // continuar funcionando, não virar tela em branco.
    const modulos = await modulosDaConta(prismaCom(null, null, []), "x");
    expect(modulos.has("operacao")).toBe(true);
  });

  it("módulo desligado some do teto e poda o papel", async () => {
    const semFinanceiro = TODOS_MODULOS.filter((m) => m.chave !== "financeiro");
    const teto = await tetoDaConta(
      prismaCom(
        { ehPlataforma: false, permissoesPermitidas: ["viagens.ver", "acertos.ver"] },
        null,
        semFinanceiro,
      ),
      "x",
    );
    expect(teto.has("viagens.ver")).toBe(true);
    // `acertos` é do módulo Financeiro: sem contrato, a chave não é concedível
    // nem que esteja explicitamente na lista da conta.
    expect(teto.has("acertos.ver")).toBe(false);
  });

  it("vigência que ainda não começou não conta", async () => {
    const futuro = [
      { chave: "financeiro", vigenteDe: new Date("2030-01-01"), vigenteAte: null },
    ];
    const modulos = await modulosDaConta(prismaCom(null, null, futuro), "x", new Date("2026-06-10"));
    expect(modulos.has("financeiro")).toBe(false);
  });

  it("vigência vencida não conta", async () => {
    const passado = [
      { chave: "financeiro", vigenteDe: null, vigenteAte: new Date("2026-05-31") },
    ];
    const modulos = await modulosDaConta(prismaCom(null, null, passado), "x", new Date("2026-06-10"));
    expect(modulos.has("financeiro")).toBe(false);
  });

  it("o último dia da vigência ainda vale", async () => {
    const ate = [{ chave: "financeiro", vigenteDe: null, vigenteAte: new Date("2026-06-10") }];
    const modulos = await modulosDaConta(prismaCom(null, null, ate), "x", new Date("2026-06-10"));
    expect(modulos.has("financeiro")).toBe(true);
  });

  it("chave de módulo que não existe no catálogo é ignorada", async () => {
    const lixo = [{ chave: "modulo-inventado", vigenteDe: null, vigenteAte: null }];
    const modulos = await modulosDaConta(prismaCom(null, null, lixo), "x");
    expect(modulos.has("modulo-inventado" as never)).toBe(false);
  });

  it("a casa continua com o catálogo inteiro, módulo não a limita", async () => {
    // A plataforma opera o produto: limitar ela por contrato não faz sentido.
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: true, permissoesPermitidas: [] }, null, []),
      "x",
    );
    expect(teto.size).toBe(TODAS_AS_CHAVES.length);
  });
});
