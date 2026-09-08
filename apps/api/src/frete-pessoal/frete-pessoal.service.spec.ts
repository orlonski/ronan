import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ComprovantePessoalPublico } from "@ronan/shared-types";
import { FretePessoalService } from "./frete-pessoal.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RoteamentoService } from "../roteamento/roteamento.service";
import type { PedagiosRodoviaConsultaService } from "../admin/pedagios-rodovia/pedagios-rodovia-consulta.service";
import type { DocumentosPessoaisService } from "./documentos-pessoais.service";

const EU = "identidade-do-motorista";
const OUTRO = "identidade-de-outra-pessoa";

function montar(opts: {
  litros?: number;
  gastoCombustivel?: number;
  km?: number;
  rota?:
    | { km: string; duracaoSegundos: number; geometria: string | null }
    | { km: null; erro: string };
  pedagios?: { nome: string }[];
  comprovante?: Record<string, unknown> | null;
  viagens?: Record<string, unknown>[];
}) {
  const prisma = {
    lancamentoPessoal: {
      aggregate: vi.fn(async () => ({
        _sum: {
          litros: opts.litros == null ? null : new Prisma.Decimal(opts.litros),
          valor: opts.gastoCombustivel == null ? null : new Prisma.Decimal(opts.gastoCombustivel),
        },
      })),
    },
    viagemPessoal: {
      aggregate: vi.fn(async () => ({
        _sum: { km: opts.km == null ? null : new Prisma.Decimal(opts.km) },
      })),
      findMany: vi.fn(async () => opts.viagens ?? []),
    },
    comprovantePessoal: {
      findUnique: vi.fn(async () => opts.comprovante ?? null),
      updateMany: vi.fn(async (args: { where: { identidadeId: string } }) => ({
        count: args.where.identidadeId === EU ? 1 : 0,
      })),
    },
  } as unknown as PrismaService;

  const roteamento = {
    calcularEntreCoordenadas: vi.fn(async () =>
      opts.rota ?? { km: "118.40", duracaoSegundos: 5400, geometria: "abc" },
    ),
  } as unknown as RoteamentoService;

  const pedagios = {
    pedagiosNaGeometria: vi.fn(async () => opts.pedagios ?? []),
  } as unknown as PedagiosRodoviaConsultaService;

  // A carteira só é consultada no link do tipo CADASTRO — nestes testes o
  // comprovante é sempre de FRETES.
  const documentos = {
    cadastroPublico: vi.fn(async () => ({ motorista: "", destinatario: null, documentos: [], tudoEmDia: false })),
  } as unknown as DocumentosPessoaisService;
  return { service: new FretePessoalService(prisma, roteamento, pedagios, documentos), prisma };
}

const ORIGEM = { lat: -25.09, lng: -50.16 };
const DESTINO = { lat: -25.43, lng: -49.27 };

describe("vale a pena esse frete?", () => {
  it("estima o diesel com o consumo e o preço DELE", async () => {
    // 1.180 km rodados com 400 L = 2,95 km/L; R$ 2.600 em 400 L = R$ 6,50/L.
    const { service } = montar({ km: 1180, litros: 400, gastoCombustivel: 2600 });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.km).toBe(118.4);
    expect(r.consumoKmPorLitro).toBe(2.95);
    expect(r.precoLitro).toBe(6.5);
    // 118,4 km ÷ 2,95 km/L × R$ 6,50
    expect(r.diesel).toBe(260.88);
  });

  it("sem histórico não inventa média de mercado — o diesel fica em branco", async () => {
    // É dinheiro do cara: um número plausível e errado é pior que número nenhum.
    const { service } = montar({});
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.consumoKmPorLitro).toBeNull();
    expect(r.diesel).toBeNull();
    expect(r.km).toBe(118.4);
  });

  it("abasteceu mas nunca lançou frete com km: sem consumo, sem estimativa", async () => {
    const { service } = montar({ litros: 400, gastoCombustivel: 2600 });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.precoLitro).toBe(6.5);
    expect(r.consumoKmPorLitro).toBeNull();
    expect(r.diesel).toBeNull();
  });

  it("lista as praças que a rota cruza", async () => {
    const { service } = montar({ pedagios: [{ nome: "Praça São Luiz do Purunã" }] });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.pedagios).toHaveLength(1);
    expect(r.pedagiosDesconhecidos).toBe(false);
  });

  it("sem geometria diz que NÃO SABE — diferente de dizer que não tem pedágio", async () => {
    const { service } = montar({
      rota: { km: "118.40", duracaoSegundos: 5400, geometria: null },
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.pedagiosDesconhecidos).toBe(true);
    expect(r.pedagios).toEqual([]);
  });

  it("rota indisponível não derruba a tela: devolve o erro e os números dele", async () => {
    const { service } = montar({
      rota: { km: null, erro: "Servidor de rotas não configurado." },
      litros: 400,
      gastoCombustivel: 2600,
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.km).toBeNull();
    expect(r.erro).toContain("rotas");
    expect(r.precoLitro).toBe(6.5);
  });
});

describe("comprovante pra quem vai pagar", () => {
  const comprovante = {
    identidadeId: EU,
    tipo: "FRETES" as const,
    inicio: new Date("2026-09-01T00:00:00.000Z"),
    fim: new Date("2026-09-30T00:00:00.000Z"),
    destinatario: "Construtora Alvorada",
    revogadoEm: null,
    identidade: { nome: "João da Silva" },
  };
  const viagem = {
    data: new Date("2026-09-05T00:00:00.000Z"),
    origem: "Ponta Grossa",
    destino: "Curitiba",
    carga: "Brita",
    km: new Prisma.Decimal("118.40"),
    peso: new Prisma.Decimal("28.500"),
    valorRecebido: new Prisma.Decimal("1300.00"),
  };

  it("a página pública mostra o frete e soma o período", async () => {
    const { service } = montar({ comprovante, viagens: [viagem] });
    const p = (await service.comprovantePublico("tok")) as ComprovantePessoalPublico;
    expect(p.motorista).toBe("João da Silva");
    expect(p.viagens).toHaveLength(1);
    expect(p.totalKm).toBe(118.4);
    expect(p.totalRecebido).toBe(1300);
  });

  it("não vaza CPF, telefone nem gasto pra quem abre o link", async () => {
    const { service } = montar({ comprovante, viagens: [viagem] });
    const p = (await service.comprovantePublico("tok")) as ComprovantePessoalPublico;
    const texto = JSON.stringify(p);
    expect(texto).not.toContain("cpf");
    expect(texto).not.toContain("telefone");
    expect(p.viagens[0]).not.toHaveProperty("identidadeId");
  });

  it("comprovante revogado responde igual a link inexistente", async () => {
    // Quem tem um link velho não descobre nem que ele já existiu.
    const { service } = montar({
      comprovante: { ...comprovante, revogadoEm: new Date() },
    });
    await expect(service.comprovantePublico("tok")).rejects.toThrow(NotFoundException);
  });

  it("não revoga o comprovante de outra pessoa", async () => {
    const { service } = montar({});
    await expect(service.revogarComprovante(OUTRO, "tok")).rejects.toThrow(NotFoundException);
  });
});
