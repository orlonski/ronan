import { describe, expect, it } from "vitest";
import {
  CAPACIDADE_POR_CHAVE,
  CATALOGO_PERMISSOES,
  DefinicaoEtapaInput,
  MODELOS_ETAPA_PRONTOS,
  MODULOS_PADRAO,
  MODULOS_POR_CHAVE,
  ResponderEtapaInput,
  SeguiuSemEtapaInput,
  calcularEstadoEtapas,
  itemCompleto,
  itensDaDefinicao,
  lerDefinicaoEtapa,
  lerItemEtapa,
  moduloDaChave,
  type EntradaEstadoEtapas,
} from "@ronan/shared-types";

/**
 * ETAPAS DA VIAGEM — a regra do que falta (shared-types), que o servidor e o
 * app usam igual. O caso que importa é o formulário que ninguém abriu: ele
 * tem que aparecer como faltando (B2 do QA).
 */

const def = lerDefinicaoEtapa({
  v: 1,
  areas: [
    {
      titulo: "Ordem",
      itens: [
        { chave: "ordem", rotulo: "Ordem", tipo: "FOTO_OU_PDF", obrigatorio: true },
        { chave: "tarifa", rotulo: "Tarifa", tipo: "VALOR", obrigatorio: true },
        { chave: "obs", rotulo: "Obs", tipo: "TEXTO", obrigatorio: false },
      ],
    },
    {
      titulo: "MDF-e",
      itens: [
        {
          chave: "mdfe_enc",
          rotulo: "Comprovante de encerramento",
          tipo: "FOTO_OU_PDF",
          obrigatorio: true,
          seFaltar: "NAO_SEGUIR",
          escritorioPodeAnexar: true,
        },
      ],
    },
  ],
});

function entrada(over: Partial<EntradaEstadoEtapas> = {}): EntradaEstadoEtapas {
  return {
    viagem: { finalizada: true, tiposEventoRegistrados: [] },
    modelos: [{ modeloId: "m1", nome: "Descarga", momento: "FIM", tipoEventoId: null, versaoId: "v1", definicao: def }],
    respostas: [],
    acoes: [],
    ...over,
  };
}

describe("lerDefinicaoEtapa (leitor tolerante)", () => {
  it("forma desconhecida vira formulário vazio, nunca lança", () => {
    expect(lerDefinicaoEtapa(null).areas).toEqual([]);
    expect(lerDefinicaoEtapa({ v: 2, areas: [] }).areas).toEqual([]);
    expect(lerDefinicaoEtapa("lixo").areas).toEqual([]);
  });

  it("pula tipo que não conhece (app velho, tipo novo) e chave repetida", () => {
    const d = lerDefinicaoEtapa({
      v: 1,
      areas: [
        {
          titulo: "A",
          itens: [
            { chave: "a", rotulo: "A", tipo: "GPS_3D", obrigatorio: true },
            { chave: "b", rotulo: "B", tipo: "TEXTO", obrigatorio: true },
            { chave: "b", rotulo: "B de novo", tipo: "TEXTO", obrigatorio: true },
          ],
        },
        { titulo: "Só lixo", itens: [{ tipo: "???" }] },
      ],
    });
    expect(itensDaDefinicao(d).map((i) => i.rotulo)).toEqual(["B"]);
    expect(d.areas).toHaveLength(1);
  });

  it("NAO_SEGUIR em item opcional vira AVISAR (não há o que parar)", () => {
    expect(lerItemEtapa({ chave: "x", rotulo: "X", tipo: "FOTO", obrigatorio: false, seFaltar: "NAO_SEGUIR" })?.seFaltar).toBe(
      "AVISAR",
    );
  });
});

describe("DefinicaoEtapaInput (estrito, painel)", () => {
  it("os três modelos prontos passam no Zod estrito", () => {
    for (const m of MODELOS_ETAPA_PRONTOS) expect(DefinicaoEtapaInput.safeParse(m.definicao).success).toBe(true);
    expect(MODELOS_ETAPA_PRONTOS.map((m) => m.momento)).toEqual(["INICIO", "FIM", "AVULSA"]);
  });

  it("CT-e, MDF-e, ordem e comprovante de encerramento são FOTO OU PDF (chegam em PDF pelo WhatsApp)", () => {
    const todos = MODELOS_ETAPA_PRONTOS.flatMap((m) => itensDaDefinicao(lerDefinicaoEtapa(m.definicao)));
    for (const chave of ["cte", "mdfe", "ordem", "comprovante_encerramento_mdfe"]) {
      expect(todos.find((i) => i.chave === chave)?.tipo).toBe("FOTO_OU_PDF");
    }
    const enc = todos.find((i) => i.chave === "comprovante_encerramento_mdfe")!;
    expect(enc.seFaltar).toBe("NAO_SEGUIR");
    expect(enc.escritorioPodeAnexar).toBe(true);
  });

  it("recusa NAO_SEGUIR em item opcional e chave repetida", () => {
    const base = { chave: "a", rotulo: "A", tipo: "FOTO" as const, obrigatorio: false, seFaltar: "NAO_SEGUIR" as const };
    expect(DefinicaoEtapaInput.safeParse({ v: 1, areas: [{ titulo: "A", itens: [base] }] }).success).toBe(false);
    const dup = { ...base, obrigatorio: true, seFaltar: "AVISAR" as const };
    expect(DefinicaoEtapaInput.safeParse({ v: 1, areas: [{ titulo: "A", itens: [dup, dup] }] }).success).toBe(false);
  });
});

describe("itemCompleto", () => {
  const item = (o: Record<string, unknown>) => lerItemEtapa({ chave: "k", rotulo: "K", obrigatorio: true, ...o })!;

  it("foto conta só arquivo vivo e respeita o mínimo", () => {
    expect(itemCompleto(item({ tipo: "FOTO" }), { arquivos: 0 })).toBe(false);
    expect(itemCompleto(item({ tipo: "FOTO" }), { arquivos: 1 })).toBe(true);
    expect(itemCompleto(item({ tipo: "FOTO", fotos: { min: 2, max: 5 } }), { arquivos: 1 })).toBe(false);
  });

  it("texto com foto exige os dois", () => {
    const i = item({ tipo: "TEXTO_COM_FOTO" });
    expect(itemCompleto(i, { texto: "Vidal (Rondonópolis)", arquivos: 0 })).toBe(false);
    expect(itemCompleto(i, { texto: "  ", arquivos: 1 })).toBe(false);
    expect(itemCompleto(i, { texto: "Vidal", arquivos: 1 })).toBe(true);
  });

  it("sim/não: escolher basta, a não ser que o extra da resposta seja EXIGE", () => {
    const i = item({
      tipo: "SIM_NAO",
      simNao: { aoSim: { foto: "EXIGE", comentario: "NAO" }, aoNao: { foto: "NAO", comentario: "EXIGE" } },
    });
    expect(itemCompleto(i, {})).toBe(false);
    expect(itemCompleto(i, { simNao: true, arquivos: 0 })).toBe(false);
    expect(itemCompleto(i, { simNao: true, arquivos: 1 })).toBe(true);
    expect(itemCompleto(i, { simNao: false })).toBe(false);
    expect(itemCompleto(i, { simNao: false, comentario: "sem canhoto, cliente fechado" })).toBe(true);
  });

  it("assinatura pede o nome quando configurado; valor zero vale", () => {
    expect(itemCompleto(item({ tipo: "ASSINATURA", assinatura: { pedeNome: true } }), { assinatura: "M1 1 L2 2" })).toBe(false);
    expect(
      itemCompleto(item({ tipo: "ASSINATURA", assinatura: { pedeNome: true } }), { assinatura: "M1 1 L2 2", assinanteNome: "Ana" }),
    ).toBe(true);
    expect(itemCompleto(item({ tipo: "VALOR" }), { valor: 0 })).toBe(true);
  });
});

describe("calcularEstadoEtapas — o que falta, calculado na leitura", () => {
  it("formulário que ninguém abriu = todos os obrigatórios faltando (B2)", () => {
    const r = calcularEstadoEtapas(entrada());
    const e = r.etapas[0]!;
    expect(e.respondida).toBe(false);
    expect(e.situacao).toBe("FALTANDO");
    expect(e.faltando.map((f) => f.itemChave)).toEqual(["ordem", "tarifa", "mdfe_enc"]);
    expect(r.documentosFaltando).toBe(3);
    expect(e.itens.find((i) => i.chave === "obs")?.estado).toBe("OPCIONAL_VAZIO");
    expect(e.pedeMotivoPraSeguir).toBe(true);
  });

  it("descarga (FIM) com a viagem em andamento: momento não chegou, não conta como faltando", () => {
    const r = calcularEstadoEtapas(entrada({ viagem: { finalizada: false, tiposEventoRegistrados: [] } }));
    expect(r.etapas[0]!.situacao).toBe("AINDA_NAO");
    expect(r.etapas[0]!.pedeMotivoPraSeguir).toBe(false);
    expect(r.documentosFaltando).toBe(0);
  });

  it("carga (INICIO) já deve na viagem em andamento", () => {
    const r = calcularEstadoEtapas(
      entrada({
        viagem: { finalizada: false, tiposEventoRegistrados: [] },
        modelos: [{ modeloId: "m1", nome: "Carga", momento: "INICIO", tipoEventoId: null, versaoId: "v1", definicao: def }],
      }),
    );
    expect(r.etapas[0]!.situacao).toBe("FALTANDO");
  });

  it("EVENTO só deve depois de a parada ser registrada", () => {
    const m = { modeloId: "m1", nome: "Balança", momento: "EVENTO" as const, tipoEventoId: "t9", versaoId: "v1", definicao: def };
    expect(calcularEstadoEtapas(entrada({ modelos: [m] })).etapas[0]!.situacao).toBe("AINDA_NAO");
    expect(
      calcularEstadoEtapas(entrada({ modelos: [m], viagem: { finalizada: false, tiposEventoRegistrados: ["t9"] } })).etapas[0]!
        .situacao,
    ).toBe("FALTANDO");
  });

  it("resposta completa os itens; anexo e dispensa do escritório suprem; 'seguiu sem' NÃO supre", () => {
    const r = calcularEstadoEtapas(
      entrada({
        respostas: [{ modeloId: "m1", concluida: true, itens: { ordem: { arquivos: 1 }, tarifa: { valor: 165 } } }],
        acoes: [
          { modeloId: "m1", itemChave: "mdfe_enc", tipo: "SEGUIU_SEM", motivo: null, motivoCodigo: "JA_COM_ESCRITORIO", em: "2026-10-06T10:00:00Z" },
        ],
      }),
    );
    const e = r.etapas[0]!;
    expect(e.faltando).toHaveLength(1);
    expect(e.faltando[0]!.seguiuSem?.motivoCodigo).toBe("JA_COM_ESCRITORIO");
    expect(e.itensFeitos).toBe(2);

    const anexado = calcularEstadoEtapas(
      entrada({
        respostas: [{ modeloId: "m1", concluida: true, itens: { ordem: { arquivos: 1 }, tarifa: { valor: 165 } } }],
        acoes: [{ modeloId: "m1", itemChave: "mdfe_enc", tipo: "ANEXADO_ESCRITORIO", motivo: null, em: "2026-10-06T11:00:00Z" }],
      }),
    );
    expect(anexado.etapas[0]!.situacao).toBe("COMPLETA");
    expect(anexado.etapas[0]!.itens.find((i) => i.chave === "mdfe_enc")?.estado).toBe("ANEXADO_ESCRITORIO");
    expect(anexado.etapas[0]!.pedeMotivoPraSeguir).toBe(false);
    expect(anexado.documentosFaltando).toBe(0);
  });

  it("dispensar o formulário inteiro (itemChave null) supre tudo", () => {
    const r = calcularEstadoEtapas(
      entrada({ acoes: [{ modeloId: "m1", itemChave: null, tipo: "DISPENSADO", motivo: "cliente sem MDF-e", em: "2026-10-06T10:00:00Z" }] }),
    );
    expect(r.etapas[0]!.situacao).toBe("COMPLETA");
    expect(r.documentosFaltando).toBe(0);
  });
});

describe("contrato das rotas /m/etapas", () => {
  const uuid = "3f1c2b8e-1d2c-4b5a-9e8f-0a1b2c3d4e5f";

  it("POST aceita o mínimo e normaliza arquivos/removidos pra lista vazia", () => {
    const r = ResponderEtapaInput.parse({
      clientId: uuid,
      viagemClientId: uuid,
      modeloId: uuid,
      versaoId: uuid,
      itens: [{ chave: "ordem", respondidoEm: "2026-10-06T10:00:00Z" }],
    });
    expect(r.itens[0]!.arquivos).toEqual([]);
    expect(r.itens[0]!.arquivosRemovidos).toEqual([]);
  });

  it("assinatura passa pela mesma regex do recebedor (sem script no path)", () => {
    const base = { clientId: uuid, viagemClientId: uuid, modeloId: uuid, versaoId: uuid };
    const ok = { chave: "assinatura", assinatura: "M10 10 L20 20 Q30 30 40 40", respondidoEm: "2026-10-06T10:00:00Z" };
    expect(ResponderEtapaInput.safeParse({ ...base, itens: [ok] }).success).toBe(true);
    const ruim = { ...ok, assinatura: "<script>alert(1)</script>" };
    expect(ResponderEtapaInput.safeParse({ ...base, itens: [ruim] }).success).toBe(false);
  });

  it("seguir sem com OUTRO exige o texto", () => {
    const base = {
      clientId: uuid,
      viagemClientId: uuid,
      modeloId: uuid,
      itens: ["mdfe_enc"],
      acao: "INICIAR_PROXIMA",
      ocorridoEm: "2026-10-06T10:00:00Z",
    };
    expect(SeguiuSemEtapaInput.safeParse({ ...base, motivoCodigo: "OUTRO" }).success).toBe(false);
    expect(SeguiuSemEtapaInput.safeParse({ ...base, motivoCodigo: "OUTRO", motivoTexto: "balança quebrada" }).success).toBe(true);
    expect(SeguiuSemEtapaInput.safeParse({ ...base, motivoCodigo: "JA_COM_ESCRITORIO" }).success).toBe(true);
  });
});

describe("módulo `etapas`, permissões e capacidade (decisões do dono, 06/10/2026)", () => {
  it("adicional, sem depender do Financeiro, fora do pacote de conta nova/teste grátis", () => {
    const m = MODULOS_POR_CHAVE.etapas;
    expect(m.adicional).toBe(true);
    expect(m.dependeDe ?? []).toEqual([]);
    expect(MODULOS_PADRAO).not.toContain("etapas");
    expect(m.recursos.sort()).toEqual(["etapas-respostas", "etapas-viagem"]);
  });

  it("as chaves novas existem no catálogo e pertencem ao módulo", () => {
    const chaves = CATALOGO_PERMISSOES.map((p) => p.chave);
    for (const c of ["etapas-viagem.ver", "etapas-viagem.criar", "etapas-viagem.editar", "etapas-respostas.ver", "etapas-respostas.editar"]) {
      expect(chaves).toContain(c);
      expect(moduloDaChave(c)).toBe("etapas");
    }
  });

  it("a capacidade do app nasce DESLIGADA, é do módulo e nunca recusa o que chega depois do corte", () => {
    const c = CAPACIDADE_POR_CHAVE["app.viagem.etapas"];
    expect(c.nasceDesligada).toBe(true);
    expect(c.modulo).toBe("etapas");
    expect(c.aoPerder).toBe("VALA");
    expect(c.colunaLegada).toBeUndefined();
  });
});
