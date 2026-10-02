import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  avaliarCodigo,
  CODIGO_MAX_TENTATIVAS,
  gerarCodigo,
  gerarTokenSessao,
  hashSegredo,
  normalizarTelefoneEncarregado,
  podeAprovarProgramada,
  podeReenviar,
  PREFIXO_TOKEN,
  sessaoValida,
  situacaoParaObra,
} from "./encarregado-regras";
import {
  serializarPedidoObra,
  serializarProgramada,
  serializarTicket,
} from "./encarregado-whitelist";
import { calcularSaldoPedido } from "../common/pedido-saldo";

const agora = new Date("2026-10-02T15:00:00Z");
const daqui = (min: number) => new Date(agora.getTime() + min * 60_000);

describe("telefone do encarregado", () => {
  it("aceita o que a pessoa digita e guarda 11 dígitos", () => {
    expect(normalizarTelefoneEncarregado("(43) 99912-3456")).toBe("43999123456");
    expect(normalizarTelefoneEncarregado("+55 43 99912-3456")).toBe("43999123456");
  });

  it("devolve o nono dígito a celular antigo", () => {
    expect(normalizarTelefoneEncarregado("43 9912-3456")).toBe("43999123456");
  });

  it("recusa fixo e lixo: código não chega em telefone fixo", () => {
    expect(normalizarTelefoneEncarregado("(43) 3333-4444")).toBeNull();
    expect(normalizarTelefoneEncarregado("123")).toBeNull();
    expect(normalizarTelefoneEncarregado("00000000002")).toBeNull();
  });
});

describe("código de entrada", () => {
  it("tem 6 dígitos", () => {
    for (let i = 0; i < 50; i++) expect(gerarCodigo()).toMatch(/^\d{6}$/);
  });

  it("guarda o hash, não o código", () => {
    expect(hashSegredo("123456")).not.toContain("123456");
    expect(hashSegredo("123456")).toBe(hashSegredo("123456"));
  });

  const pendente = (over: Partial<{ codigo: string; expiraEm: Date; tentativas: number }> = {}) => ({
    codigoHash: hashSegredo(over.codigo ?? "123456"),
    expiraEm: over.expiraEm ?? daqui(10),
    tentativas: over.tentativas ?? 0,
  });

  it("certo dentro do prazo entra", () => {
    expect(avaliarCodigo(pendente(), "123456", agora)).toEqual({ ok: true });
  });

  it("errado conta como tentativa", () => {
    expect(avaliarCodigo(pendente(), "654321", agora)).toEqual({ ok: false, motivo: "ERRADO" });
  });

  it("sem código pendente não entra", () => {
    expect(avaliarCodigo(null, "123456", agora)).toEqual({ ok: false, motivo: "SEM_CODIGO" });
  });

  it("vencido não entra, mesmo certo", () => {
    expect(avaliarCodigo(pendente({ expiraEm: daqui(-1) }), "123456", agora)).toEqual({
      ok: false,
      motivo: "VENCIDO",
    });
  });

  it("depois de 5 erros nem o certo entra (o limite não é enfeite)", () => {
    expect(
      avaliarCodigo(pendente({ tentativas: CODIGO_MAX_TENTATIVAS }), "123456", agora),
    ).toEqual({ ok: false, motivo: "TENTATIVAS" });
    expect(avaliarCodigo(pendente({ tentativas: CODIGO_MAX_TENTATIVAS - 1 }), "123456", agora)).toEqual({
      ok: true,
    });
  });

  it("1 minuto entre envios pro mesmo número", () => {
    expect(podeReenviar(null, agora)).toBe(true);
    expect(podeReenviar(new Date(agora.getTime() - 30_000), agora)).toBe(false);
    expect(podeReenviar(new Date(agora.getTime() - 60_000), agora)).toBe(true);
  });
});

describe("sessão do portal", () => {
  it("token opaco com prefixo próprio e entropia de sobra", () => {
    const t = gerarTokenSessao();
    expect(t.startsWith(PREFIXO_TOKEN)).toBe(true);
    expect(t.length).toBeGreaterThanOrEqual(45);
    expect(gerarTokenSessao()).not.toBe(t);
  });

  const s = (over: Partial<{ expiraEm: Date; revogadaEm: Date | null; ativo: boolean; obraAtiva: boolean }> = {}) => ({
    expiraEm: over.expiraEm ?? daqui(60),
    revogadaEm: over.revogadaEm ?? null,
    encarregado: { ativo: over.ativo ?? true, cliente: { ativa: over.obraAtiva ?? true } },
  });

  it("vale enquanto tudo está em ordem", () => {
    expect(sessaoValida(s(), agora)).toBe(true);
  });

  it("fail-closed: revogada, vencida, desativado ou obra encerrada = não", () => {
    expect(sessaoValida(null, agora)).toBe(false);
    expect(sessaoValida(s({ revogadaEm: daqui(-5) }), agora)).toBe(false);
    expect(sessaoValida(s({ expiraEm: daqui(-1) }), agora)).toBe(false);
    expect(sessaoValida(s({ ativo: false }), agora)).toBe(false);
    expect(sessaoValida(s({ obraAtiva: false }), agora)).toBe(false);
  });
});

describe("programação vista pela obra", () => {
  it("fala a língua do cliente, não a do quadro", () => {
    expect(situacaoParaObra("PUBLICADA")).toBe("Programado");
    expect(situacaoParaObra("PLANEJADA")).toBe("Programado");
    expect(situacaoParaObra("CUMPRIDA")).toBe("Entregue");
  });

  it("só aprova o que ainda vai acontecer", () => {
    const base = { viagemId: null, aprovadaObraEm: null };
    expect(podeAprovarProgramada({ ...base, status: "PUBLICADA" })).toBe(true);
    expect(podeAprovarProgramada({ ...base, status: "CUMPRIDA" })).toBe(false);
    expect(podeAprovarProgramada({ ...base, status: "CANCELADA" })).toBe(false);
    expect(podeAprovarProgramada({ ...base, status: "PUBLICADA", viagemId: "v1" })).toBe(false);
    expect(podeAprovarProgramada({ ...base, status: "ACEITA", aprovadaObraEm: agora })).toBe(false);
  });

  it("whitelist: sai só placa, janela, material e a situação", () => {
    const out = serializarProgramada({
      id: "p1",
      dataPrevista: new Date("2026-10-03T00:00:00Z"),
      janelaInicio: "07:00",
      janelaFim: null,
      status: "PUBLICADA",
      viagemId: null,
      aprovadaObraEm: null,
      veiculo: { placa: "ABC1D23" },
      pedido: { numero: 12, material: { nome: "Brita 1" } },
      // Campos que existem no banco e NÃO podem sair, mesmo se alguém mudar o select:
      ...({ motorista: { nome: "Zé", telefone: "43999990000" }, observacao: "interno" } as object),
    } as Parameters<typeof serializarProgramada>[0]);
    expect(Object.keys(out).sort()).toEqual(
      [
        "aprovadaEm",
        "data",
        "id",
        "janelaFim",
        "janelaInicio",
        "material",
        "pedidoNumero",
        "placa",
        "podeAprovar",
        "situacao",
        "status",
      ].sort(),
    );
    expect(JSON.stringify(out)).not.toContain("Zé");
    expect(out.data).toBe("2026-10-03");
  });
});

describe("ticket do dia na obra", () => {
  const viagem = {
    id: "v1",
    data: new Date("2026-10-02T00:00:00Z"),
    criadoOfflineEm: null,
    sincronizadoEm: new Date("2026-10-02T13:20:00Z"), // 10:20 em Brasília
    ticket: "T-889",
    veiculo: { placa: "ABC1D23" },
    material: { nome: "Areia" },
    fotos: [{ id: "f1", rotacao: 90 }],
    valor: { valorTotal: new Prisma.Decimal("1234.5") },
    ...({ motorista: { nome: "Zé", cpf: "000" }, km: 42, cargaLat: -23.3 } as object),
  } as Parameters<typeof serializarTicket>[0];

  it("hora em Brasília, peso efetivo, sem motorista nem posição", () => {
    const t = serializarTicket(viagem, new Prisma.Decimal("14"), false);
    expect(t.hora).toBe("10:20");
    expect(t.toneladas).toBe("14.000");
    const json = JSON.stringify(t);
    expect(json).not.toContain("Zé");
    expect(json).not.toContain("cargaLat");
    expect(json).not.toContain("km");
  });

  it("R$ só com podeVerValores — e a chave nem aparece sem ele", () => {
    expect("valor" in serializarTicket(viagem, null, false)).toBe(false);
    expect(serializarTicket(viagem, null, true).valor).toBe("1234.50");
  });
});

describe("saldo da obra (contratado x entregue x saldo)", () => {
  const pedido = {
    numero: 7,
    unidadeAlvo: "TONELADAS" as const,
    prazoEm: null,
    material: { nome: "Brita" },
  };

  it("deriva das viagens, e sem valor quando não pode", () => {
    const saldo = calcularSaldoPedido({
      quantidadeAlvo: "100",
      unidadeAlvo: "TONELADAS",
      viagens: [{ toneladas: "30" }, { toneladas: "25.5" }],
    });
    const out = serializarPedidoObra(pedido, saldo, { podeVerValores: false, valorEntregue: new Prisma.Decimal(900) });
    expect(out.contratado).toBe("100.000");
    expect(out.entregue).toBe("55.500");
    expect(out.saldo).toBe("44.500");
    expect(out.viagens).toBe(2);
    expect("valorEntregue" in out).toBe(false);
  });

  it("com permissão, mostra o valor do que foi entregue", () => {
    const saldo = calcularSaldoPedido({ quantidadeAlvo: 3, unidadeAlvo: "VIAGENS", viagens: [{ toneladas: 1 }] });
    const out = serializarPedidoObra({ ...pedido, unidadeAlvo: "VIAGENS" }, saldo, {
      podeVerValores: true,
      valorEntregue: new Prisma.Decimal("450"),
    });
    expect(out.valorEntregue).toBe("450.00");
    expect(out.saldo).toBe("2");
  });
});
