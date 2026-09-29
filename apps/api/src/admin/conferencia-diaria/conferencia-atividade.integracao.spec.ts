import "reflect-metadata";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { inicioDoDiaData } from "../../common/timezone";
import type { PrismaService } from "../../prisma/prisma.service";
import { ConferenciaDiariaService, SUPRIMIDA_SEM_MOVIMENTO } from "./conferencia-diaria.service";

/**
 * Regra de atividade (`janelaAtividadeDias`) com Prisma REAL (banco descartável).
 * Só roda com `CONFERENCIA_TESTE_DATABASE_URL` apontando pra um banco novo com as
 * migrations aplicadas; sem a variável, pula. O WhatsApp é SEMPRE mock.
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;

// 28/09/2026 é segunda-feira; 09:00 em São Paulo. O dia esperado anterior é a sexta 25/09.
const SEGUNDA = new Date("2026-09-28T12:00:00Z");
const DIA = inicioDoDiaData(SEGUNDA);
const SUF = Date.now().toString(36);
// Valor de FIXTURE deste teste (a janela real é escolha de cada empresa na tela).
const JANELA_DO_TESTE = 30;

describe.skipIf(!URL_TESTE)("conferência diária: regra de atividade (Prisma real)", () => {
  let prisma: PrismaService;
  let servico: ConferenciaDiariaService;
  let conta: string;
  let contaDesligada: string;
  let admin: string;
  let veiculo: string;
  let n = 0;
  const ids: Record<string, string> = {};

  const envio = {
    disponivel: vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; motivo?: string }> => ({ ok: true })),
    tentarEnviar: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ enviado: true, idExterno: "wamid.MOCK" })),
  };

  const motorista = (c: string, nome: string, over: Record<string, unknown> = {}) =>
    comConta(c, () =>
      prisma.motorista.create({
        data: {
          nome,
          cpf: `5${SUF.replace(/\D/g, "1").padEnd(4, "1").slice(0, 4)}${String(++n).padStart(6, "0")}`.slice(0, 11),
          senhaHash: "x",
          telefone: `4299108${String(1000 + n)}`,
          status: "APROVADO",
          aceite: "ACEITO",
          criadoEm: new Date("2026-01-01T00:00:00Z"),
          ...over,
        } as never,
      }),
    );
  const viagem = (c: string, motoristaId: string, data: string, status = "ENVIADA") =>
    comConta(c, () =>
      prisma.viagem.create({
        data: { clientId: `cv-${SUF}-${++n}`, motoristaId, veiculoId: veiculo, data: new Date(`${data}T00:00:00Z`), status } as never,
      }),
    );
  const linhas = (c: string) =>
    comConta(c, () => prisma.conferenciaDiaria.findMany({ where: { dia: DIA }, include: { motorista: { select: { nome: true } } } }));
  const daPessoa = async (c: string, nome: string) => (await linhas(c)).find((l) => l.motorista.nome === nome)!;
  type Interno = { gravarODia(cfg: unknown, c: string, a: Date): Promise<number>; enviarPendentes(cfg: unknown, a: Date): Promise<number>; calcular(cfg: unknown, a: Date): Promise<never[]> };
  const rodar = async (cfg: unknown, c: string) => {
    const i = servico as unknown as Interno;
    const n = await i.gravarODia(cfg, c, SEGUNDA);
    await i.enviarPendentes(cfg, SEGUNDA);
    return n;
  };
  const cfgDe = (c: string) => comConta(c, () => prisma.configuracaoConferenciaDiaria.findFirstOrThrow());

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    servico = new ConferenciaDiariaService(
      prisma,
      new AuditoriaService(prisma),
      envio as never,
      { manter: vi.fn() } as never,
      {} as never,
    );
    const nova = async (nome: string) =>
      (await comoSistema(() => prisma.conta.create({ data: { nome, slug: `${nome}-${SUF}` } }))).id;
    conta = await nova("atividade-ligada");
    contaDesligada = await nova("atividade-desligada");
    admin = (
      await comConta(conta, () =>
        prisma.user.create({ data: { nome: "Gestor", email: `gestor-atv-${SUF}@teste.local`, senhaHash: "x" } as never }),
      )
    ).id;
    veiculo = (await comConta(conta, () => prisma.veiculo.create({ data: { placa: `ATV${SUF.slice(0, 4).toUpperCase()}` } as never }))).id;
    const veiculoDes = (
      await comConta(contaDesligada, () => prisma.veiculo.create({ data: { placa: `ATD${SUF.slice(0, 4).toUpperCase()}` } as never }))
    ).id;

    const base = { ativo: true, modo: "ENVIANDO", horaEnvio: 9, diasConsiderados: [1, 2, 3, 4, 5], intervaloMinimoDias: 3 };
    await comConta(conta, () =>
      prisma.configuracaoConferenciaDiaria.create({ data: { ...base, janelaAtividadeDias: JANELA_DO_TESTE } as never }),
    );
    await comConta(contaDesligada, () => prisma.configuracaoConferenciaDiaria.create({ data: base as never }));

    // ── Conta com a regra ligada: 10 motoristas ──
    const especs: [string, string | null, Record<string, unknown>?, string?][] = [
      ["Recente A", "2026-09-20"],
      ["Recente B", "2026-09-10"],
      ["No limite", "2026-08-29"], // exatamente 30 dias antes de 28/09: ainda ativo
      ["Parado um dia a mais", "2026-08-28"], // 31 dias
      ["Parado antigo", "2026-06-05"],
      ["Parado sem telefone", "2026-08-01", { telefone: null }],
      ["Nunca lançou", null],
      ["Em andamento", null], // viagem guiada: data ainda nula, iniciada no domingo (criada abaixo)
      ["Lançou sexta", "2026-09-25"],
      ["Recente sem canal", "2026-09-20", { aceitaWhatsapp: false }],
    ];
    for (const [nome, data, over, status] of especs) {
      const m = await motorista(conta, nome, over);
      ids[nome] = m.id;
      if (data) await viagem(conta, m.id, data, status);
    }
    await comConta(conta, () =>
      prisma.viagem.create({
        data: {
          clientId: `cv-and-${SUF}`,
          motoristaId: ids["Em andamento"]!,
          veiculoId: veiculo,
          data: null,
          status: "EM_ANDAMENTO",
          iniciadoEm: new Date("2026-09-27T15:00:00Z"),
        } as never,
      }),
    );
    // Mesmo cenário na conta com a regra DESLIGADA (default 0): comportamento de sempre.
    const antigo = await motorista(contaDesligada, "Parado antigo");
    ids["desligada:Parado antigo"] = antigo.id;
    await comConta(contaDesligada, () =>
      prisma.viagem.create({
        data: { clientId: `cv-d-${SUF}`, motoristaId: antigo.id, veiculoId: veiculoDes, data: new Date("2026-06-05T00:00:00Z") } as never,
      }),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });
  afterEach(() => vi.useRealTimers());

  it("default da coluna é 0 (regra desligada) e conta existente não muda", async () => {
    expect((await cfgDe(contaDesligada)).janelaAtividadeDias).toBe(0);
    expect((await cfgDe(conta)).janelaAtividadeDias).toBe(JANELA_DO_TESTE);
  });

  it("job em modo ENVIANDO: só os elegíveis recebem; parados ficam SUPRIMIDA/SEM_MOVIMENTO sem envio", async () => {
    envio.tentarEnviar.mockClear();
    const cfg = await cfgDe(conta);
    // O mesmo caminho do job (gravar o dia e mandar os pendentes), sem depender do módulo contratado.
    const gravadas = await comConta(conta, () => rodar(cfg, conta));
    expect(gravadas).toBe(10);

    const enviadosPara = new Set<string>();
    const porEstado = async (nome: string) => (await daPessoa(conta, nome)).estado;
    for (const nome of ["Recente A", "Recente B", "No limite", "Nunca lançou"]) {
      expect(await porEstado(nome), nome).toBe("ENVIADA");
      enviadosPara.add(nome);
    }
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(4);

    for (const nome of ["Parado um dia a mais", "Parado antigo", "Parado sem telefone"]) {
      const l = await daPessoa(conta, nome);
      expect(l.estado, nome).toBe("SUPRIMIDA");
      expect(l.suprimidaPor, nome).toBe(SUPRIMIDA_SEM_MOVIMENTO);
      expect(l.wamid).toBeNull();
      expect(l.enviadaEm).toBeNull();
      expect(l.motivo).toMatch(/^Sem viagem há mais de 30 dias \(última em \d{2}\/\d{2}\/2026\)\.$/);
      const snap = l.snapshot as { semMovimento: boolean; deveriaPerguntar: boolean; semCanal: unknown; evidencias: { diasSemMovimento: number } };
      expect(snap.semMovimento).toBe(true);
      expect(snap.deveriaPerguntar).toBe(false);
      expect(snap.semCanal).toBeNull();
      expect(snap.evidencias.diasSemMovimento).toBeGreaterThan(JANELA_DO_TESTE);
    }
    expect((await daPessoa(conta, "Parado um dia a mais")).motivo).toContain("28/08/2026");

    // Quem nunca lançou segue a regra dele; quem tem viagem em andamento é movimento.
    expect((await daPessoa(conta, "Em andamento")).suprimidaPor).toBeNull();
    expect((await daPessoa(conta, "Lançou sexta")).suprimidaPor).toBeNull();
    // Sem canal continua sendo sem canal (e só ele).
    const semCanal = await daPessoa(conta, "Recente sem canal");
    expect(semCanal.estado).toBe("SUPRIMIDA");
    expect(semCanal.suprimidaPor).toBe("NAO_ACEITA_WHATSAPP");

    // Nenhum parado foi pra Meta.
    const chamadas = envio.tentarEnviar.mock.calls.length;
    expect(chamadas).toBe(4);
    expect(cfg.janelaAtividadeDias).toBe(JANELA_DO_TESTE);
  });

  it("regra desligada (0): o mesmo motorista parado É perguntado, como sempre", async () => {
    envio.tentarEnviar.mockClear();
    await comConta(contaDesligada, async () => rodar(await cfgDe(contaDesligada), contaDesligada));
    const l = await daPessoa(contaDesligada, "Parado antigo");
    expect(l.estado).toBe("ENVIADA");
    expect(l.suprimidaPor).toBeNull();
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(1);
  });

  it("lista do dia: SEM_MOVIMENTO vem marcado, com telefone mascarado, e nunca como 'sem canal'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SEGUNDA);
    const r = await comConta(conta, () => servico.listaDoDia());
    const item = (nome: string) => r.itens.find((i) => i.nome === nome)!;
    const antigo = item("Parado antigo");
    expect(antigo).toMatchObject({ semMovimento: true, deveriaPerguntar: false, semCanal: null });
    expect(antigo.telefoneMascarado).toMatch(/^••••-\d{4}$/);
    expect(item("Parado sem telefone")).toMatchObject({ semMovimento: true, semCanal: null, telefoneMascarado: null });
    expect(item("Recente A")).toMatchObject({ semMovimento: false, deveriaPerguntar: true });
    // A marca "sem canal" é só de quem realmente não tem canal.
    expect(r.itens.filter((i) => i.deveriaPerguntar && i.semCanal).map((i) => i.nome)).toEqual(["Recente sem canal"]);
    expect(r.itens.filter((i) => i.semMovimento)).toHaveLength(3);
  });

  it("simular: mesma regra, sem gravar, com o grupo semMovimento", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SEGUNDA);
    const antes = (await linhas(conta)).length;
    const r = await comConta(conta, () => servico.simular());
    expect(r.gravado).toBe(false);
    expect(r.regraEmVigor).toContain(`nos últimos ${JANELA_DO_TESTE} dias`);
    expect(r.itens.filter((i) => i.semMovimento).map((i) => i.nome).sort()).toEqual([
      "Parado antigo",
      "Parado sem telefone",
      "Parado um dia a mais",
    ]);
    expect((await linhas(conta)).length).toBe(antes);
  });

  it("calendário do parado: SEM_MOVIMENTO não aparece como pergunta nem em semCanal", async () => {
    const c = await comConta(conta, () => servico.calendarioDoMotorista(ids["Parado antigo"]!, "2026-09", SEGUNDA));
    expect(c.dias.every((d) => !d.pergunta)).toBe(true);
    expect(c.totais).toMatchObject({ perguntados: 0, semCanal: 0 });
    // Quem está sem canal de verdade continua aparecendo como tal.
    const cs = await comConta(conta, () => servico.calendarioDoMotorista(ids["Recente sem canal"]!, "2026-09", SEGUNDA));
    expect(cs.totais.semCanal).toBe(1);
  });

  it("não conta no intervalo nem no máximo semanal: no dia seguinte o parado que voltou é avaliado limpo", async () => {
    const cfg = await cfgDe(conta);
    // Ele lança uma viagem: volta a ser elegível, sem nenhuma "pergunta anterior" na conta.
    await viagem(conta, ids["Parado antigo"]!, "2026-09-15");
    const itens = await comConta(conta, () => (servico as unknown as Interno).calcular(cfg, SEGUNDA));
    const i = (itens as { nome: string; semMovimento: boolean; deveriaPerguntar: boolean; evidencias: { perguntasNaSemana: number; ultimaPergunta: unknown } }[]).find(
      (x) => x.nome === "Parado antigo",
    )!;
    expect(i.semMovimento).toBe(false);
    expect(i.deveriaPerguntar).toBe(true);
    expect(i.evidencias.ultimaPergunta).toBeNull();
    expect(i.evidencias.perguntasNaSemana).toBe(0);
  });

  it("reenvio NÃO vale pro parado (mensagem própria) e segue valendo pra quem foi perguntado", async () => {
    await expect(
      comConta(conta, () => servico.reenviarPerguntaDeHoje(ids["Parado um dia a mais"]!, admin, SEGUNDA)),
    ).rejects.toThrow(/sem movimento/);
    await expect(
      comConta(conta, () => servico.reenviarPerguntaDeHoje(ids["Parado um dia a mais"]!, admin, SEGUNDA)),
    ).rejects.toBeInstanceOf(ConflictException);

    envio.tentarEnviar.mockClear();
    const r = await comConta(conta, () => servico.reenviarPerguntaDeHoje(ids["Recente A"]!, admin, SEGUNDA));
    expect(r.enviado).toBe(true);
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(1);
  });

  it("botão de TESTE manual continua funcionando pro parado (decisão do gestor) e a linha deixa de ser SEM_MOVIMENTO", async () => {
    envio.tentarEnviar.mockClear();
    const r = await comConta(conta, () => servico.enviarPerguntaDeTeste(ids["Parado antigo"]!, admin, SEGUNDA));
    expect(r.enviado).toBe(true);
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(1);

    const outro = ids["Parado um dia a mais"]!;
    const r2 = await comConta(conta, () => servico.enviarPerguntaDeTeste(outro, admin, SEGUNDA));
    expect(r2.enviado).toBe(true);
    const l = await daPessoa(conta, "Parado um dia a mais");
    expect(l.estado).toBe("ENVIADA");
    expect(l.suprimidaPor).toBeNull();
  });

  it("a linha de teste do parado não vira 'sem canal' no calendário: aparece como pergunta de teste enviada", async () => {
    const c = await comConta(conta, () => servico.calendarioDoMotorista(ids["Parado um dia a mais"]!, "2026-09", SEGUNDA));
    expect(c.totais.semCanal).toBe(0);
    expect(c.totais.perguntados).toBeGreaterThanOrEqual(1);
  });
});
