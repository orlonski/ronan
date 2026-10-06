import { describe, expect, it } from "vitest";
import {
  chaveDoItem,
  dataBRDeInstante,
  detectarPedagioEmDobro,
  ficaramDeFora,
  selecionarItensDoAcerto,
  type OcupacaoItem,
} from "./acerto-selecao";

const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);

const frete = (viagemId: string) => ({
  tipo: "FRETE",
  viagemId,
  descricao: `Viagem ${viagemId}`,
  valor: "150.00",
});
const pedagioAvulso = (pedagioId: string) => ({
  tipo: "REEMBOLSO_PEDAGIO",
  pedagioId,
  descricao: `Pedágio ${pedagioId}`,
  valor: "23.40",
});

function ocup(p: Partial<OcupacaoItem> & { chave: string; acertoId: string }): OcupacaoItem {
  return {
    itemId: `item-${p.acertoId}-${p.chave}`,
    status: "ABERTO",
    periodoInicio: dia("2026-09-01"),
    periodoFim: dia("2026-09-15"),
    automatico: true,
    ...p,
  };
}

describe("chaveDoItem", () => {
  it("gasto de viagem tem chave própria: a trava do fechamento cobre ele também", () => {
    expect(chaveDoItem({ tipo: "REEMBOLSO_DESPESA", despesaId: "d1" })).toBe("DESPESA:d1");
    expect(chaveDoItem({ tipo: "REEMBOLSO_DESPESA" })).toBeNull();
  });

  it("frete e pedágio da MESMA viagem são lançamentos diferentes", () => {
    expect(chaveDoItem({ tipo: "FRETE", viagemId: "v1" })).toBe("FRETE:v1");
    expect(chaveDoItem({ tipo: "REEMBOLSO_PEDAGIO", viagemId: "v1", pedagioId: "p1" })).toBe(
      "PEDAGIO_VIAGEM:v1",
    );
  });

  it("pedágio avulso e abastecimento têm chave própria", () => {
    expect(chaveDoItem({ tipo: "REEMBOLSO_PEDAGIO", pedagioId: "p1" })).toBe("PEDAGIO:p1");
    expect(chaveDoItem({ tipo: "REEMBOLSO_ABASTECIMENTO", abastecimentoId: "a1" })).toBe(
      "ABASTECIMENTO:a1",
    );
  });

  it("adiantamento, desconto e bônus não têm o que repetir", () => {
    expect(chaveDoItem({ tipo: "ADIANTAMENTO" })).toBeNull();
    expect(chaveDoItem({ tipo: "BONUS" })).toBeNull();
  });
});

describe("selecionarItensDoAcerto", () => {
  it("o que não está em acerto nenhum entra, sem aviso", () => {
    const r = selecionarItensDoAcerto({
      candidatos: [frete("v1")],
      acertoAtualId: null,
      ocupacoes: [],
    });
    expect(r.entram.map((i) => i.viagemId)).toEqual(["v1"]);
    expect(r.entram[0].puxadoDe).toBeNull();
    expect(r.puxar).toEqual([]);
  });

  it("período que cruza um acerto FECHADO não paga a mesma viagem de novo", () => {
    // O caso que pagava duas vezes: 01–15 fechado, depois gera 01–30.
    const r = selecionarItensDoAcerto({
      candidatos: [frete("v1"), frete("v2")],
      acertoAtualId: "novo",
      ocupacoes: [ocup({ chave: "FRETE:v1", acertoId: "velho", status: "FECHADO" })],
    });
    expect(r.entram.map((i) => i.viagemId)).toEqual(["v2"]);
    expect(r.jaFechados).toEqual([
      { chave: "FRETE:v1", acertoId: "velho", rotulo: "acerto de 01/09 a 15/09" },
    ]);
  });

  it("acerto PAGO também segura o item", () => {
    const r = selecionarItensDoAcerto({
      candidatos: [pedagioAvulso("p1")],
      acertoAtualId: "novo",
      ocupacoes: [ocup({ chave: "PEDAGIO:p1", acertoId: "pago", status: "PAGO" })],
    });
    expect(r.entram).toEqual([]);
    expect(r.puxar).toEqual([]);
  });

  it("item em outro acerto ABERTO é puxado pra cá, com o aviso de onde veio", () => {
    const r = selecionarItensDoAcerto({
      candidatos: [frete("v1")],
      acertoAtualId: "novo",
      ocupacoes: [ocup({ chave: "FRETE:v1", acertoId: "esquecido", itemId: "it9" })],
    });
    expect(r.entram).toHaveLength(1);
    expect(r.entram[0].puxadoDe).toBe("Este item saiu do acerto de 01/09 a 15/09.");
    expect(r.puxar).toEqual([
      { itemId: "it9", acertoId: "esquecido", chave: "FRETE:v1", de: "acerto de 01/09 a 15/09" },
    ]);
  });

  it("incluído À MÃO em outro ABERTO não se puxa — é decisão de gente", () => {
    const r = selecionarItensDoAcerto({
      candidatos: [frete("v1")],
      acertoAtualId: "novo",
      ocupacoes: [ocup({ chave: "FRETE:v1", acertoId: "outro", automatico: false })],
    });
    expect(r.entram).toEqual([]);
    expect(r.puxar).toEqual([]);
    expect(r.aMaoEmOutro).toHaveLength(1);
  });

  it("regerar o próprio acerto não acusa puxada e não duplica o que já foi incluído à mão", () => {
    const r = selecionarItensDoAcerto({
      candidatos: [frete("v1"), frete("v2")],
      acertoAtualId: "este",
      ocupacoes: [
        ocup({ chave: "FRETE:v1", acertoId: "este" }), // automático dele: vai ser regerado
        ocup({ chave: "FRETE:v2", acertoId: "este", automatico: false }), // incluído à mão
      ],
    });
    expect(r.entram.map((i) => i.viagemId)).toEqual(["v1"]);
    expect(r.entram[0].puxadoDe).toBeNull();
    expect(r.puxar).toEqual([]);
  });

  it("regerar mantém o aviso de uma puxada anterior", () => {
    const r = selecionarItensDoAcerto({
      candidatos: [frete("v1")],
      acertoAtualId: "este",
      ocupacoes: [
        ocup({ chave: "FRETE:v1", acertoId: "este", puxadoDe: "Este item saiu do acerto de 01/09 a 15/09." }),
      ],
    });
    expect(r.entram[0].puxadoDe).toBe("Este item saiu do acerto de 01/09 a 15/09.");
  });

  it("FECHADO vence ABERTO: se está fechado em algum lugar, não entra nem é puxado", () => {
    const r = selecionarItensDoAcerto({
      candidatos: [frete("v1")],
      acertoAtualId: "novo",
      ocupacoes: [
        ocup({ chave: "FRETE:v1", acertoId: "aberto" }),
        ocup({ chave: "FRETE:v1", acertoId: "fechado", status: "FECHADO" }),
      ],
    });
    expect(r.entram).toEqual([]);
    expect(r.puxar).toEqual([]);
  });

  it("item sem lançamento por trás sempre entra", () => {
    const r = selecionarItensDoAcerto({
      candidatos: [{ tipo: "BONUS", descricao: "x", valor: "1" }],
      acertoAtualId: "novo",
      ocupacoes: [],
    });
    expect(r.entram).toHaveLength(1);
  });
});

describe("ficaramDeFora", () => {
  it("lista só o que não está em acerto nenhum", () => {
    const r = ficaramDeFora(
      [frete("v1"), frete("v2"), pedagioAvulso("p1")],
      new Set(["FRETE:v1"]),
    );
    expect(r.map((i) => i.chave)).toEqual(["FRETE:v2", "PEDAGIO:p1"]);
  });
});

describe("detectarPedagioEmDobro", () => {
  const viagem = (dia: string, total: string, valor = total) => ({
    itemId: `iv-${dia}`,
    viagemId: `v-${dia}`,
    dia,
    valorPedagioTotal: total,
    valor,
    descricao: `Pedágio da viagem ${dia}`,
  });
  const avulso = (id: string, dia: string, valor: string) => ({
    itemId: `ia-${id}`,
    pedagioId: id,
    dia,
    valor,
    descricao: `Pedágio ${dia}`,
  });

  it("mesmo dia: viagem com pedágio total e avulso sem viagem vira aviso", () => {
    const g = detectarPedagioEmDobro({
      viagens: [viagem("2026-09-10", "23.40")],
      avulsos: [avulso("p1", "2026-09-10", "23.40")],
      decisoes: new Map(),
    });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ dia: "2026-09-10", totalViagens: "23.40", totalAvulsos: "23.40", pendentes: 1 });
  });

  it("dias diferentes não acusam nada", () => {
    const g = detectarPedagioEmDobro({
      viagens: [viagem("2026-09-10", "23.40")],
      avulsos: [avulso("p1", "2026-09-11", "23.40")],
      decisoes: new Map(),
    });
    expect(g).toEqual([]);
  });

  it("viagem sem pedágio total (o pedágio veio dos vinculados) não entra na comparação", () => {
    const g = detectarPedagioEmDobro({
      viagens: [viagem("2026-09-10", "0", "23.40")],
      avulsos: [avulso("p1", "2026-09-10", "23.40")],
      decisoes: new Map(),
    });
    expect(g).toEqual([]);
  });

  it("decisão tomada fica no grupo e zera o pendente", () => {
    const g = detectarPedagioEmDobro({
      viagens: [viagem("2026-09-10", "50")],
      avulsos: [avulso("p1", "2026-09-10", "23.40"), avulso("p2", "2026-09-10", "10")],
      decisoes: new Map([
        ["p1", { decisao: "PEDAGIOS_DIFERENTES" as const, decididoPor: "Ana", decididoEm: dia("2026-09-20") }],
      ]),
    });
    expect(g[0].pendentes).toBe(1);
    expect(g[0].avulsos.find((a) => a.pedagioId === "p1")?.decisao?.decididoPor).toBe("Ana");
  });
});

describe("dataBRDeInstante", () => {
  it("abastecimento às 22h de SP fica no dia de SP, não no dia UTC", () => {
    // 30/09 22:00 em São Paulo = 01/10 01:00Z.
    expect(dataBRDeInstante(new Date("2026-10-01T01:00:00Z"))).toBe("30/09/2026");
  });
});
