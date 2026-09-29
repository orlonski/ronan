import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import type { PrismaService } from "../../prisma/prisma.service";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";
import { ConferenciaRespostaService } from "./conferencia-resposta.service";

/**
 * O calendário NÃO pode perder o que o motorista já respondeu quando um novo teste
 * zera a linha do job de hoje. Prisma REAL (banco descartável): só roda com
 * `CONFERENCIA_TESTE_DATABASE_URL` (banco novo com `prisma migrate deploy`); sem a
 * variável, pula. Envio ao WhatsApp é SEMPRE mock.
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;
const SEGUNDA = new Date("2026-09-28T12:00:00Z");
const FONE = "5542991088125";
const SUF = Date.now().toString(36);

describe.skipIf(!URL_TESTE)("calendário da conferência: perguntas anteriores (Prisma real)", () => {
  let prisma: PrismaService;
  let servico: ConferenciaDiariaService;
  let resposta: ConferenciaRespostaService;
  let conta: string;
  let admin: string;
  let motorista: string;
  let seq = 0;

  const envio = {
    disponivel: vi.fn(async () => ({ ok: true })),
    tentarEnviar: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ enviado: true, idExterno: `wamid.T${++seq}` })),
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    const auditoria = new AuditoriaService(prisma);
    const sugestoes = { abrir: vi.fn(async () => ({ id: "s", criada: true })), notificar: vi.fn(async () => {}), manter: vi.fn() };
    servico = new ConferenciaDiariaService(prisma, auditoria, envio as never, sugestoes as never, {} as never);
    resposta = new ConferenciaRespostaService(prisma, envio as never, auditoria, sugestoes as never, { aoResponder: vi.fn(async () => {}) } as never);
    conta = (await comoSistema(() => prisma.conta.create({ data: { nome: "cal-ant", slug: `cal-ant-${SUF}` } }))).id;
    admin = (
      await comConta(conta, () => prisma.user.create({ data: { nome: "Gestor", email: `g-${SUF}@teste.local`, senhaHash: "x" } as never }))
    ).id;
    await comConta(conta, () =>
      prisma.configuracaoConferenciaDiaria.create({ data: { ativo: true, modo: "ENVIANDO", horaEnvio: 9, diasConsiderados: [1, 2, 3, 4, 5] } as never }),
    );
    motorista = (
      await comConta(conta, () =>
        prisma.motorista.create({
          data: { nome: "Tião", cpf: "55555555555", senhaHash: "x", telefone: "42991088125", status: "APROVADO", aceite: "ACEITO", criadoEm: new Date("2026-01-01T00:00:00Z") } as never,
        }),
      )
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const perguntar = (dia: string) => comConta(conta, () => servico.enviarPerguntaDeTeste(motorista, admin, SEGUNDA, dia));
  const calendario = () => comConta(conta, () => servico.calendarioDoMotorista(motorista, "2026-09", SEGUNDA, true));
  const linha = () => comConta(conta, () => prisma.conferenciaDiaria.findFirstOrThrow({ where: { motoristaId: motorista } }));
  const tocar = async (opcao: string) => {
    const l = await linha();
    return resposta.tratarMensagem({
      id: `wamid.TOQUE.${Math.random()}`,
      from: FONE,
      type: "button",
      button: { payload: `cv:${l.id}:${opcao}`, text: "x" },
      context: { id: l.wamid! },
    } as never);
  };
  const dia = (c: Awaited<ReturnType<typeof calendario>>, d: string) => c.dias.find((x) => x.dia === d)!;

  it("respondeu o dia 24, depois testes em outros dias: o 24 continua no calendário como teste anterior", async () => {
    // Segunda 28/09: primeiro teste, sobre quinta 24.
    await perguntar("2026-09-24");
    expect((await tocar("NAO_TIVE")).tratada).toBe(true);
    let c = await calendario();
    expect(dia(c, "2026-09-24").pergunta).toMatchObject({ estado: "RESPONDIDA", resposta: "NAO_TIVE" });
    expect(dia(c, "2026-09-24").pergunta?.historica).toBeUndefined();

    // Segundo teste, outro dia: a linha é ZERADA e passa a falar do 23.
    await perguntar("2026-09-23");
    c = await calendario();
    expect(dia(c, "2026-09-23").pergunta).toMatchObject({ estado: "ENVIADA", resposta: null });
    expect(dia(c, "2026-09-23").pergunta?.historica).toBeUndefined();
    expect(dia(c, "2026-09-24").pergunta).toMatchObject({
      historica: true,
      origem: "TESTE_ANTERIOR",
      estado: "RESPONDIDA",
      resposta: "NAO_TIVE",
    });
    expect(dia(c, "2026-09-24").pergunta?.respondidaEm).not.toBeNull();
    expect(dia(c, "2026-09-24").pergunta?.tecnico?.trilha.length).toBeGreaterThan(0);
    expect(c.totais).toMatchObject({ perguntados: 2, respondidos: 1 });

    // Terceiro teste: os DOIS anteriores seguem lá.
    await perguntar("2026-09-22");
    c = await calendario();
    expect(dia(c, "2026-09-22").pergunta?.historica).toBeUndefined();
    expect(dia(c, "2026-09-23").pergunta).toMatchObject({ historica: true, estado: "ENVIADA" });
    expect(dia(c, "2026-09-24").pergunta).toMatchObject({ historica: true, estado: "RESPONDIDA", resposta: "NAO_TIVE" });

    // Reenvio pro MESMO dia (22): não cria histórica nova nem apaga as outras.
    await perguntar("2026-09-22");
    c = await calendario();
    expect(c.dias.filter((d) => d.pergunta)).toHaveLength(3);
    expect(dia(c, "2026-09-24").pergunta?.historica).toBe(true);

    // Voltar a perguntar o dia 24: a ATUAL vence a histórica, e o 22 vira histórica.
    await perguntar("2026-09-24");
    c = await calendario();
    expect(dia(c, "2026-09-24").pergunta).toMatchObject({ estado: "ENVIADA", resposta: null });
    expect(dia(c, "2026-09-24").pergunta?.historica).toBeUndefined();
    expect(dia(c, "2026-09-22").pergunta).toMatchObject({ historica: true, estado: "ENVIADA" });
  });

  it("sem o pedido técnico o calendário não vaza trilha/wamid da histórica", async () => {
    const c = await comConta(conta, () => servico.calendarioDoMotorista(motorista, "2026-09", SEGUNDA, false));
    const historicas = c.dias.filter((d) => d.pergunta?.historica);
    expect(historicas.length).toBeGreaterThan(0);
    for (const h of historicas) expect(h.pergunta).not.toHaveProperty("tecnico");
  });
});
