import { describe, expect, it } from "vitest";
import type { ItemRespostaInput } from "@ronan/shared-types";
import { dadosDaChaveEtapa, foraDaJanela, marcasDaResposta, mesclarItem, type ItemGravado } from "./etapa-regras";

const SHA = "a".repeat(64);
const CONTA = "conta-1";
const MOT = "mot-1";
const chave = (over: Partial<{ conta: string; pasta: string; dia: string; mot: string; nome: string }> = {}) =>
  [
    over.conta ?? CONTA,
    over.pasta ?? "etapas",
    over.dia ?? "2026-10-06",
    over.mot ?? MOT,
    over.nome ?? `${SHA}_6b1d.pdf`,
  ].join("/");

describe("dadosDaChaveEtapa — de quem é o arquivo (I5 do QA)", () => {
  it("chave dele, nesta conta: devolve sha e mime pela extensão", () => {
    expect(dadosDaChaveEtapa(chave(), CONTA, MOT)).toEqual({ sha256: SHA, mime: "application/pdf" });
    expect(dadosDaChaveEtapa(chave({ nome: `${SHA}_x.jpg` }), CONTA, MOT)).toEqual({ sha256: SHA, mime: "image/jpeg" });
  });

  it("outra conta, outro motorista, outra pasta: recusa", () => {
    expect(dadosDaChaveEtapa(chave({ conta: "conta-2" }), CONTA, MOT)).toBe(false);
    expect(dadosDaChaveEtapa(chave({ mot: "mot-2" }), CONTA, MOT)).toBe(false);
    expect(dadosDaChaveEtapa(chave({ pasta: "despesas" }), CONTA, MOT)).toBe(false);
  });

  it("caminho torto, extensão que não serve ou dia inválido: recusa", () => {
    expect(dadosDaChaveEtapa(`${CONTA}/etapas/../${MOT}/${SHA}_x.pdf`, CONTA, MOT)).toBe(false);
    expect(dadosDaChaveEtapa(chave({ nome: `${SHA}_x.html` }), CONTA, MOT)).toBe(false);
    expect(dadosDaChaveEtapa(chave({ dia: "ontem" }), CONTA, MOT)).toBe(false);
    expect(dadosDaChaveEtapa(`${chave()}/extra`, CONTA, MOT)).toBe(false);
  });
});

describe("foraDaJanela / marcas — aceita e carimba, nunca recusa", () => {
  const fim = new Date("2026-09-01T00:00:00Z");
  it("em andamento nunca está fora; finalizada passa da janela depois de N+1 dias", () => {
    expect(foraDaJanela({ finalizada: false, fim, janelaDias: 30, agora: new Date("2027-01-01") })).toBe(false);
    expect(foraDaJanela({ finalizada: true, fim, janelaDias: 30, agora: new Date("2026-10-01T12:00:00Z") })).toBe(false);
    expect(foraDaJanela({ finalizada: true, fim, janelaDias: 30, agora: new Date("2026-10-03T00:00:00Z") })).toBe(true);
  });

  it("sem o módulo carimba SEM_MODULO; marcas anteriores ficam", () => {
    expect(
      marcasDaResposta({ moduloContratado: false, modeloAtivo: true, versaoEhAtual: true, foraDaJanela: false }),
    ).toEqual(["SEM_MODULO"]);
    expect(
      marcasDaResposta({
        moduloContratado: true,
        modeloAtivo: false,
        versaoEhAtual: false,
        foraDaJanela: true,
        anteriores: ["SEM_MODULO"],
      }),
    ).toEqual(["FORA_DA_JANELA", "MODELO_INATIVO", "SEM_MODULO", "VERSAO_ANTIGA"]);
  });
});

describe("mesclarItem — POST idempotente que soma", () => {
  const t0 = new Date("2026-10-06T10:00:00Z");
  const t1 = new Date("2026-10-06T11:00:00Z");
  const novo = (o: Partial<ItemRespostaInput>): ItemRespostaInput => ({
    chave: "k",
    arquivos: [],
    arquivosRemovidos: [],
    respondidoEm: t0,
    ...o,
  });
  const gravado = (o: Partial<ItemGravado>): ItemGravado => ({
    simNao: null,
    texto: null,
    numero: null,
    valor: null,
    comentario: null,
    assinatura: null,
    assinanteNome: null,
    respondidoEm: t0,
    arquivos: [],
    ...o,
  });

  it("item novo: cria com o que veio (ausente vira null)", () => {
    const p = mesclarItem(null, novo({ valor: 165, arquivos: [{ storageKey: "a" }] }));
    expect(p.acao).toBe("CRIAR");
    expect(p.valores.valor).toBe(165);
    expect(p.valores.texto).toBeNull();
    expect(p.adicionar.map((a) => a.storageKey)).toEqual(["a"]);
  });

  it("reenvio idêntico (outbox mandou duas vezes): NADA", () => {
    const g = gravado({ valor: 165, arquivos: [{ storageKey: "a", removido: false }] });
    const p = mesclarItem(g, novo({ valor: 165, arquivos: [{ storageKey: "a" }] }));
    expect(p.acao).toBe("NADA");
  });

  it("campo ausente fica como está; arquivo novo SOMA", () => {
    const g = gravado({ texto: "Vidal", arquivos: [{ storageKey: "a", removido: false }] });
    const p = mesclarItem(g, novo({ respondidoEm: t1, arquivos: [{ storageKey: "b" }] }));
    expect(p.acao).toBe("ATUALIZAR");
    expect(p.valores).toEqual({});
    expect(p.adicionar.map((a) => a.storageKey)).toEqual(["b"]);
    expect(p.antes).toBeNull();
  });

  it("envio mais novo troca o valor e guarda o anterior (corrigido às)", () => {
    const p = mesclarItem(gravado({ valor: 160 }), novo({ valor: 165, respondidoEm: t1 }));
    expect(p.valores).toEqual({ valor: 165 });
    expect(p.antes).toEqual({ valor: 160 });
    expect(p.respondidoEm).toEqual(t1);
  });

  it("primeiro preenchimento de um campo não é correção (sem histórico)", () => {
    const p = mesclarItem(gravado({ valor: null }), novo({ valor: 165, respondidoEm: t1 }));
    expect(p.antes).toBeNull();
  });

  it("envio VELHO chegando atrasado não desfaz o novo — mas os arquivos dele ainda somam", () => {
    const g = gravado({ valor: 170, respondidoEm: t1 });
    const p = mesclarItem(g, novo({ valor: 160, respondidoEm: t0, arquivos: [{ storageKey: "c" }] }));
    expect(p.valores).toEqual({});
    expect(p.adicionar.map((a) => a.storageKey)).toEqual(["c"]);
    expect(p.respondidoEm).toEqual(t1);
  });

  it("null limpa; arquivo só sai por arquivosRemovidos, e removido não volta pela lista", () => {
    const g = gravado({ comentario: "x", arquivos: [{ storageKey: "a", removido: false }, { storageKey: "z", removido: true }] });
    const p = mesclarItem(
      g,
      novo({ comentario: null, respondidoEm: t1, arquivos: [{ storageKey: "a" }, { storageKey: "z" }], arquivosRemovidos: ["a"] }),
    );
    expect(p.valores).toEqual({ comentario: null });
    expect(p.remover).toEqual(["a"]);
    expect(p.adicionar).toEqual([]);
  });

  it("texto em branco é o mesmo que vazio", () => {
    const p = mesclarItem(gravado({ texto: null }), novo({ texto: "   ", respondidoEm: t1 }));
    expect(p.acao).toBe("NADA");
  });
});
