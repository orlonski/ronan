import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { inicioDoDiaData } from "../../common/timezone";
import type { PrismaService } from "../../prisma/prisma.service";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";

/**
 * Limites de envio configuráveis (tolerância do envio e teto de reenvios/testes) com
 * Prisma REAL (banco descartável). Só roda com `CONFERENCIA_TESTE_DATABASE_URL` apontando
 * pra um banco novo com as migrations aplicadas; sem a variável, pula. WhatsApp SEMPRE mock.
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;

// 28/09/2026 é segunda-feira. 10:30 em São Paulo = 13:30Z: 2h30 depois das 08h do job.
const AGORA = new Date("2026-09-28T13:30:00Z");
const DIA = inicioDoDiaData(AGORA);
const SUF = Date.now().toString(36);
// Valores de FIXTURE deste teste (cada empresa escolhe os seus na tela).
const TOLERANCIA_CURTA = 1;
const LIMITE_CURTO = 2;

describe.skipIf(!URL_TESTE)("conferência diária: limites configuráveis (Prisma real)", () => {
  let prisma: PrismaService;
  let servico: ConferenciaDiariaService;
  let contaCurta: string;
  let contaPadrao: string;
  let admin: string;
  let n = 0;

  const envio = {
    disponivel: vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; motivo?: string }> => ({ ok: true })),
    tentarEnviar: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ enviado: true, idExterno: "wamid.MOCK" })),
  };

  const motorista = (c: string) =>
    comConta(c, () =>
      prisma.motorista.create({
        data: {
          nome: `Tião ${++n}`,
          cpf: `6${SUF.replace(/\D/g, "1").padEnd(4, "1").slice(0, 4)}${String(n).padStart(6, "0")}`.slice(0, 11),
          senhaHash: "x",
          telefone: "42991088125",
          status: "APROVADO",
          aceite: "ACEITO",
          criadoEm: new Date("2026-01-01T00:00:00Z"),
        } as never,
      }),
    );
  const linha = (c: string, motoristaId: string, data: Record<string, unknown>) =>
    comConta(c, () =>
      prisma.conferenciaDiaria.create({
        data: { motoristaId, dia: DIA, motivo: "x", snapshot: { deveriaPerguntar: true, evidencias: {} }, ...data } as never,
      }),
    );
  const daPessoa = (c: string, motoristaId: string) =>
    comConta(c, () => prisma.conferenciaDiaria.findFirstOrThrow({ where: { motoristaId, dia: DIA } }));
  const cfgDe = (c: string) => comConta(c, () => prisma.configuracaoConferenciaDiaria.findFirstOrThrow());
  type Interno = { enviarPendentes(cfg: unknown, a: Date): Promise<number> };
  const pendentes = async (c: string) => comConta(c, async () => (servico as unknown as Interno).enviarPendentes(await cfgDe(c), AGORA));
  const reenviar = (c: string, m: string) => comConta(c, () => servico.reenviarPerguntaDeHoje(m, admin, AGORA));
  const testar = (c: string, m: string) => comConta(c, () => servico.enviarPerguntaDeTeste(m, admin, AGORA));

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    servico = new ConferenciaDiariaService(prisma, new AuditoriaService(prisma), envio as never, { manter: vi.fn() } as never, {} as never);
    const nova = async (nome: string) => (await comoSistema(() => prisma.conta.create({ data: { nome, slug: `${nome}-${SUF}` } }))).id;
    contaCurta = await nova("limites-curtos");
    contaPadrao = await nova("limites-padrao");
    admin = (
      await comConta(contaCurta, () =>
        prisma.user.create({ data: { nome: "Gestor", email: `gestor-lim-${SUF}@teste.local`, senhaHash: "x" } as never }),
      )
    ).id;
    const base = { ativo: true, modo: "ENVIANDO", horaEnvio: 8, diasConsiderados: [1, 2, 3, 4, 5] };
    await comConta(contaCurta, () =>
      prisma.configuracaoConferenciaDiaria.create({
        data: { ...base, horasToleranciaEnvio: TOLERANCIA_CURTA, maxReenviosPorPergunta: LIMITE_CURTO } as never,
      }),
    );
    // Sem escolher nada: linha "antiga" ganha os padrões pelas colunas.
    await comConta(contaPadrao, () => prisma.configuracaoConferenciaDiaria.create({ data: base as never }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("linha de config sem os campos novos nasce com os padrões (3h, 7-21h, 5) — ninguém muda de comportamento", async () => {
    expect(await cfgDe(contaPadrao)).toMatchObject({
      horasToleranciaEnvio: 3,
      lembreteHoraMin: 7,
      lembreteHoraMax: 21,
      maxReenviosPorPergunta: 5,
    });
    expect(await cfgDe(contaCurta)).toMatchObject({ horasToleranciaEnvio: TOLERANCIA_CURTA, maxReenviosPorPergunta: LIMITE_CURTO });
  });

  it("tolerância: às 10h30 (2h30 depois do job) a empresa de 1h cancela e a de 3h (padrão) ainda envia", async () => {
    envio.tentarEnviar.mockClear();
    const mCurta = await motorista(contaCurta);
    const mPadrao = await motorista(contaPadrao);
    const lCurta = await linha(contaCurta, mCurta.id, { estado: "PENDENTE" });
    const lPadrao = await linha(contaPadrao, mPadrao.id, { estado: "PENDENTE" });

    expect(await pendentes(contaCurta)).toBe(0);
    expect(await pendentes(contaPadrao)).toBe(1);

    const c = await daPessoa(contaCurta, mCurta.id);
    expect(c.id).toBe(lCurta.id);
    expect(c.estado).toBe("FALHOU");
    expect(c.erroEnvio).toMatch(/Não saiu no horário/);
    const p = await daPessoa(contaPadrao, mPadrao.id);
    expect(p.id).toBe(lPadrao.id);
    expect(p.estado).toBe("ENVIADA");
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(1);
  });

  it("limite de reenvios da config: reenvio para no 2º e a mensagem cita 2; empresa padrão segue até 5", async () => {
    envio.tentarEnviar.mockClear();
    const m = await motorista(contaCurta);
    await linha(contaCurta, m.id, { estado: "ENVIADA", enviadaEm: AGORA, wamid: "wamid.0" });
    expect(await reenviar(contaCurta, m.id)).toMatchObject({ enviado: true, reenvios: 1 });
    expect(await reenviar(contaCurta, m.id)).toMatchObject({ enviado: true, reenvios: 2 });
    await expect(reenviar(contaCurta, m.id)).rejects.toThrow(/reenviada 2 vezes/);
    expect((await daPessoa(contaCurta, m.id)).reenvios).toBe(LIMITE_CURTO);
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(2);

    const mp = await motorista(contaPadrao);
    await linha(contaPadrao, mp.id, { estado: "ENVIADA", enviadaEm: AGORA, wamid: "wamid.0" });
    for (let i = 1; i <= 5; i++) expect(await reenviar(contaPadrao, mp.id)).toMatchObject({ enviado: true, reenvios: i });
    await expect(reenviar(contaPadrao, mp.id)).rejects.toThrow(/reenviada 5 vezes/);
  });

  it("limite de reenvios da config vale no teste manual: 2 na empresa curta, 5 na padrão", async () => {
    envio.tentarEnviar.mockClear();
    const m = await motorista(contaCurta);
    expect(await testar(contaCurta, m.id)).toMatchObject({ enviado: true, linhaCriada: true, reenvios: 0 });
    expect(await testar(contaCurta, m.id)).toMatchObject({ enviado: true, reenvios: 1 });
    expect(await testar(contaCurta, m.id)).toMatchObject({ enviado: true, reenvios: 2 });
    await expect(testar(contaCurta, m.id)).rejects.toThrow(/enviada 2 vezes/);

    const mp = await motorista(contaPadrao);
    await testar(contaPadrao, mp.id);
    for (let i = 1; i <= 5; i++) await testar(contaPadrao, mp.id);
    await expect(testar(contaPadrao, mp.id)).rejects.toThrow(/enviada 5 vezes/);
  });
});
