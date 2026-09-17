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

type AbastecimentoFake = {
  id?: string;
  data?: Date;
  odometro?: number | null;
  litros?: number | null;
  valor?: number;
  tanqueCheio?: boolean;
};

function montar(opts: {
  abastecimentos?: AbastecimentoFake[];
  eixos?: number | null;
  gastosNaoCombustivel?: number;
  kmRodado?: number;
  rota?:
    | { km: string; duracaoSegundos: number; geometria: string | null }
    | { km: null; erro: string };
  pedagios?: { nome: string; valorBase?: string | null }[];
  comprovante?: Record<string, unknown> | null;
  viagens?: Record<string, unknown>[];
  /** Lançamentos de PEDAGIO dele, como o app grava: soltos, sem viagem. */
  pedagiosLancados?: { data: Date; valor: number; viagemPessoalId?: string | null }[];
}) {
  const prisma = {
    motoristaIdentidade: {
      findUnique: vi.fn(async () => ({ eixos: opts.eixos ?? null })),
    },
    lancamentoPessoal: {
      aggregate: vi.fn(async () => ({
        _sum: {
          valor:
            opts.gastosNaoCombustivel == null
              ? null
              : new Prisma.Decimal(opts.gastosNaoCombustivel),
        },
      })),
      // A MESMA tabela serve abastecimento e pedágio; o serviço distingue pelo
      // `where.tipo` e o mock precisa distinguir também, senão o cálculo de
      // pedágio recebe a lista de abastecimentos.
      findMany: vi.fn(async (args: { where?: { tipo?: string } } = {}) => {
        if (args.where?.tipo === "PEDAGIO") {
          return (opts.pedagiosLancados ?? []).map((g) => ({
            viagemPessoalId: g.viagemPessoalId ?? null,
            data: g.data,
            valor: new Prisma.Decimal(g.valor),
          }));
        }
        return (opts.abastecimentos ?? []).map((a, i) => ({
          id: a.id ?? `ab-${i}`,
          data: a.data ?? new Date(2026, 5, 1 + i),
          odometro: a.odometro ?? null,
          litros: a.litros == null ? null : new Prisma.Decimal(a.litros),
          valor: new Prisma.Decimal(a.valor ?? 0),
          tanqueCheio: a.tanqueCheio ?? true,
          criadoEm: a.data ?? new Date(2026, 5, 1 + i),
        }));
      }),
    },
    viagemPessoal: {
      aggregate: vi.fn(async () => ({
        _sum: { km: opts.kmRodado == null ? null : new Prisma.Decimal(opts.kmRodado) },
      })),
      // `gastos` entra por padrão porque as DUAS leituras de viagem passam por
      // aqui — o histórico de valor não pede gastos, o de pedágio pede. Sem o
      // default, o teste do histórico derrubava o cálculo do pedágio.
      findMany: vi.fn(async () => (opts.viagens ?? []).map((v, i) => ({ id: `v${i}`, ...v }))),
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
    // Tanque a tanque: 100.000 → 101.180 são 1.180 km, repostos com os 400 L
    // que couberam no segundo cheio = 2,95 km/L. O preço sai do total: 600 L
    // por R$ 3.900 = R$ 6,50/L.
    const { service } = montar({
      abastecimentos: [
        { odometro: 100_000, litros: 200, valor: 1300 },
        { odometro: 101_180, litros: 400, valor: 2600 },
      ],
    });
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

  it("abasteceu sem anotar o odômetro: dá o preço do litro, não o consumo", async () => {
    // A conta antiga dividia o km dos fretes lançados pelos litros de TODOS os
    // abastecimentos — dois conjuntos que não se falam. Sem odômetro não há
    // como medir, e dizer isso é melhor que um km/l com cara de medido.
    const { service } = montar({
      abastecimentos: [
        { odometro: null, litros: 200, valor: 1300 },
        { odometro: null, litros: 400, valor: 2600 },
      ],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.precoLitro).toBe(6.5);
    expect(r.consumoKmPorLitro).toBeNull();
    expect(r.consumoMotivo).toBe("SEM_ODOMETRO");
    expect(r.diesel).toBeNull();
  });

  it("um cheio só não mede nada — precisa de dois pra ter um trecho", async () => {
    const { service } = montar({
      abastecimentos: [{ odometro: 100_000, litros: 300, valor: 1950 }],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.consumoKmPorLitro).toBeNull();
    expect(r.consumoMotivo).toBe("SEM_DOIS_CHEIOS");
    expect(r.precoLitro).toBe(6.5);
  });

  it("o parcial do meio entra em litros, não vira fronteira", async () => {
    // Ignorar o parcial daria km demais pra litros de menos: um km/l otimista
    // em cima do qual ele aceitaria frete que não paga o diesel.
    const { service } = montar({
      abastecimentos: [
        { odometro: 100_000, litros: 100, valor: 650 },
        { odometro: 100_300, litros: 50, valor: 325, tanqueCheio: false },
        { odometro: 100_600, litros: 150, valor: 975 },
      ],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    // 600 km com 200 L (50 do parcial + 150 do cheio final) = 3 km/L.
    expect(r.consumoKmPorLitro).toBe(3);
  });

  it("pedágio vira R$ quando ele diz quantos eixos roda", async () => {
    const { service } = montar({
      eixos: 6,
      pedagios: [
        { nome: "Purunã", valorBase: "12.50" },
        { nome: "Norte", valorBase: "10.00" },
      ],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.pedagioTotal).toBe(135);
    expect(r.pedagioParcial).toBe(false);
  });

  it("praça sem preço cadastrado marca o total como piso", async () => {
    const { service } = montar({
      eixos: 6,
      pedagios: [{ nome: "Purunã", valorBase: "12.50" }, { nome: "Sem preço", valorBase: null }],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.pedagioTotal).toBe(75);
    expect(r.pedagioParcial).toBe(true);
  });

  it("sem eixos cadastrados não inventa pedágio", async () => {
    const { service } = montar({ pedagios: [{ nome: "Purunã", valorBase: "12.50" }] });
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.pedagioTotal).toBeNull();
  });

  it("com o valor oferecido, responde o que SOBRA", async () => {
    // A pergunta do autônomo nunca foi "quanto é o frete".
    const { service } = montar({
      eixos: 6,
      abastecimentos: [
        { odometro: 100_000, litros: 200, valor: 1300 },
        { odometro: 101_180, litros: 400, valor: 2600 },
      ],
      gastosNaoCombustivel: 4500,
      kmRodado: 9000,
      pedagios: [{ nome: "Purunã", valorBase: "12.50" }],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO, { valorFrete: 1200 });
    // 118,4 km: diesel R$ 260,88 · pedágio R$ 75 · custo 0,50/km = R$ 59,20
    expect(r.resultado!.custoDoTrecho).toBe(59.2);
    expect(r.resultado!.sobra).toBe(804.92);
    expect(r.resultado!.incompleto).toBe(false);
  });

  it("sem o valor oferecido não há sobra pra mostrar", async () => {
    const { service } = montar({});
    const r = await service.estimar(EU, ORIGEM, DESTINO);
    expect(r.resultado).toBeNull();
  });

  it("diz por quanto ELE já fez esse mesmo trecho", async () => {
    const { service } = montar({
      viagens: [
        {
          origem: "Ponta Grossa/PR",
          destino: "Curitiba",
          data: new Date("2026-06-10"),
          km: new Prisma.Decimal(120),
          valorRecebido: new Prisma.Decimal(1100),
        },
        {
          origem: "ponta grossa",
          destino: "curitiba - pr",
          data: new Date("2026-05-01"),
          km: new Prisma.Decimal(120),
          valorRecebido: new Prisma.Decimal(900),
        },
      ],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO, {
      origem: "Ponta Grossa",
      destino: "Curitiba",
    });
    expect(r.historico!.vezes).toBe(2);
    expect(r.historico!.medianaValor).toBe(1000);
    expect(r.historico!.ultimaVez).toBe("2026-06-10");
  });

  it("sem tarifa cadastrada, o pedágio vem do que ELE pagou no trecho", async () => {
    // O cenário real: as praças estão cadastradas sem preço (o CRUD aceita), ele
    // roda 6 eixos, e lança o pedágio SOLTO — que é o único jeito que o app
    // oferece hoje. A atribuição é por dia, com uma viagem só no dia.
    const { service } = montar({
      eixos: 6,
      pedagios: [{ nome: "Purunã", valorBase: null }],
      viagens: [
        {
          origem: "Ponta Grossa",
          destino: "Curitiba",
          data: new Date("2026-06-10"),
          km: new Prisma.Decimal(120),
          valorRecebido: new Prisma.Decimal(1100),
        },
        {
          origem: "ponta grossa - pr",
          destino: "curitiba",
          data: new Date("2026-05-01"),
          km: new Prisma.Decimal(120),
          valorRecebido: new Prisma.Decimal(900),
        },
      ],
      pedagiosLancados: [
        { data: new Date("2026-06-10"), valor: 120 },
        { data: new Date("2026-05-01"), valor: 140 },
      ],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO, {
      origem: "Ponta Grossa",
      destino: "Curitiba",
      valorFrete: 2000,
    });

    // A tabela segue sem responder, e o motivo tem que dizer QUAL falta é essa:
    // mandar informar os eixos aqui seria mandar refazer o que já foi feito.
    expect(r.pedagioTotal).toBeNull();
    expect(r.pedagioMotivo).toBe("SEM_TARIFA");

    expect(r.pedagioDele!.vezes).toBe(2);
    expect(r.pedagioDele!.mediana).toBe(130);
    expect(r.pedagioDele!.ultimaVez).toBe("2026-06-10");

    // E a sobra desconta esse pedágio: deixá-lo fora faria o frete parecer
    // R$ 130 melhor do que é, que é exatamente o erro que a tela evita.
    expect(r.resultado!.pedagio).toBe(130);
  });

  it("com tarifa cadastrada, a tabela ganha do histórico — ela é do trecho de hoje", async () => {
    const { service } = montar({
      eixos: 2,
      pedagios: [{ nome: "Purunã", valorBase: "10.00" }],
      viagens: [
        {
          origem: "Ponta Grossa",
          destino: "Curitiba",
          data: new Date("2026-06-10"),
          km: new Prisma.Decimal(120),
          valorRecebido: new Prisma.Decimal(1100),
        },
      ],
      pedagiosLancados: [{ data: new Date("2026-06-10"), valor: 500 }],
    });
    const r = await service.estimar(EU, ORIGEM, DESTINO, {
      origem: "Ponta Grossa",
      destino: "Curitiba",
      valorFrete: 2000,
    });
    expect(r.pedagioTotal).toBe(20);
    expect(r.resultado!.pedagio).toBe(20);
    // O histórico continua viajando: a tela mostra os dois quando discordam.
    expect(r.pedagioDele!.mediana).toBe(500);
  });

  it("trecho que ele nunca fez não ganha referência inventada", async () => {
    const { service } = montar({ viagens: [] });
    const r = await service.estimar(EU, ORIGEM, DESTINO, {
      origem: "Jaguariaíva",
      destino: "Santos",
    });
    expect(r.historico).toBeNull();
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
      abastecimentos: [
        { odometro: 100_000, litros: 200, valor: 1300 },
        { odometro: 101_180, litros: 400, valor: 2600 },
      ],
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
