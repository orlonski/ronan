import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, ExecutionContext, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { moduloDaChave, PerguntaDeTesteSchema } from "@ronan/shared-types";
import { PERMISSAO_KEY } from "../../auth/decorators/requer-permissao.decorator";
import { PermissaoGuard } from "../../auth/guards/permissao.guard";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { inicioDoDiaData } from "../../common/timezone";
import type { PrismaService } from "../../prisma/prisma.service";
import { ConferenciaDiariaController } from "./conferencia-diaria.controller";
import { PADRAO_MAX_REENVIOS_POR_PERGUNTA } from "@ronan/shared-types";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";

/**
 * Pergunta de TESTE da conferência diária, com Prisma REAL (banco descartável).
 * Só roda com `CONFERENCIA_TESTE_DATABASE_URL` apontando pra um banco novo com as
 * migrations aplicadas (`prisma migrate deploy`); sem a variável, pula.
 *
 * O envio ao WhatsApp é SEMPRE mock: nenhuma mensagem real sai daqui.
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;

// 28/09/2026 é segunda-feira; 09:00 em São Paulo.
const SEGUNDA = new Date("2026-09-28T12:00:00Z");
const DIA_SEGUNDA = inicioDoDiaData(SEGUNDA);
const SUF = Date.now().toString(36);

describe.skipIf(!URL_TESTE)("conferência diária: pergunta de teste (Prisma real)", () => {
  let prisma: PrismaService;
  let servico: ConferenciaDiariaService;
  let contaSemConfig: string;
  let contaComConfig: string;
  let contaDesligada: string;
  let contaOutra: string;
  let admin: string;
  let n = 0;

  const envio = {
    disponivel: vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; motivo?: string }> => ({ ok: true })),
    tentarEnviar: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ enviado: true, idExterno: "wamid.PADRAO" })),
  };

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
    contaSemConfig = await nova("teste-sem-config");
    contaComConfig = await nova("teste-com-config");
    contaDesligada = await nova("teste-desligada");
    contaOutra = await nova("teste-outra");
    admin = (
      await comConta(contaComConfig, () =>
        prisma.user.create({ data: { nome: "Gestor", email: `gestor-teste-${SUF}@teste.local`, senhaHash: "x" } as never }),
      )
    ).id;
    await comConta(contaComConfig, () =>
      prisma.configuracaoConferenciaDiaria.create({
        data: { ativo: true, modo: "ENVIANDO", horaEnvio: 9, diasConsiderados: [1, 2, 3, 4, 5], intervaloMinimoDias: 3 } as never,
      }),
    );
    // A empresa NÃO ligou a conferência: o teste tem que funcionar mesmo assim.
    await comConta(contaDesligada, () =>
      prisma.configuracaoConferenciaDiaria.create({ data: { ativo: false, modo: "SOMBRA" } as never }),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const novoMotorista = (contaId: string, over: Record<string, unknown> = {}) =>
    comConta(contaId, () =>
      prisma.motorista.create({
        data: {
          nome: `Tião ${++n}`,
          cpf: `4000${SUF.slice(-3).padEnd(3, "0").replace(/\D/g, "1")}${String(n).padStart(4, "0")}`.slice(0, 11),
          senhaHash: "x",
          telefone: "42991088125",
          status: "APROVADO",
          aceite: "ACEITO",
          criadoEm: new Date("2026-01-01T00:00:00Z"),
          ...over,
        } as never,
      }),
    );
  const linhasDe = (contaId: string, motoristaId: string) =>
    comConta(contaId, () => prisma.conferenciaDiaria.findMany({ where: { motoristaId }, orderBy: { dia: "asc" } }));
  const eventos = (t: unknown) => (t as { evento: string }[]).map((e) => e.evento);
  const testar = (contaId: string, motoristaId: string, agora = SEGUNDA) =>
    comConta(contaId, () => servico.enviarPerguntaDeTeste(motoristaId, admin, agora));

  it("(a) sem linha de hoje e sem configuração: cria SÓ a linha dele, envia o template real e não cria configuração", async () => {
    const m = await novoMotorista(contaSemConfig);
    const outro = await novoMotorista(contaSemConfig);
    envio.tentarEnviar.mockClear();
    envio.tentarEnviar.mockResolvedValueOnce({ enviado: true, idExterno: "wamid.TESTE1" });

    const r = await testar(contaSemConfig, m.id);

    expect(r).toMatchObject({
      enviado: true,
      estado: "ENVIADA",
      erro: null,
      wamid: "wamid.TESTE1",
      linhaCriada: true,
      reenvios: 0,
      telefoneMascarado: "••••-8125",
      // Sem configuração: "ontem" (domingo 27/09), não um dia útil.
      diaPerguntado: "2026-09-27",
    });
    const [linha] = await linhasDe(contaSemConfig, m.id);
    expect(linha).toMatchObject({ estado: "ENVIADA", wamid: "wamid.TESTE1", motivo: "Pergunta de teste pedida pelo painel." });
    expect(linha!.dia.toISOString()).toBe(DIA_SEGUNDA.toISOString());
    expect(linha!.snapshot).toMatchObject({
      origem: "TESTE_PAINEL",
      testePedidoPor: admin,
      evidencias: { diasEsperadosVerificados: ["2026-09-27"] },
    });
    expect(eventos(linha!.trilha)).toEqual(["TESTE", "ENVIO"]);
    expect(JSON.stringify(linha!.trilha)).not.toContain("42991088125"); // telefone só mascarado

    // O mesmo template real, com os 4 botões cv:<id>:<opcao>, no número do cadastro.
    const chamada = envio.tentarEnviar.mock.calls[0]![0] as { rota: string; params: string[]; payloads: string[]; destino: { numero: string } };
    expect(chamada.rota).toBe("CONFERENCIA_DIARIA");
    expect(chamada.destino.numero).toBe("5542991088125");
    expect(chamada.params[0]).toContain("27/09");
    expect(chamada.payloads).toHaveLength(4);
    expect(chamada.payloads[0]).toBe(`cv:${linha!.id}:NAO_TIVE`);

    // Só ele: ninguém mais da empresa ganhou linha, e a config não foi criada por tabela.
    expect(await linhasDe(contaSemConfig, outro.id)).toHaveLength(0);
    expect(await comConta(contaSemConfig, () => prisma.configuracaoConferenciaDiaria.count())).toBe(0);

    const aud = await prisma.auditLog.findMany({ where: { entidade: "ConferenciaDiaria", entidadeId: linha!.id } });
    expect(aud.map((a) => a.acao)).toEqual(["CONFERENCIA_PERGUNTA_TESTE"]);
    expect(aud[0]!.usuarioId).toBe(admin);
  });

  it("(a2) com configuração: o dia perguntado é o último dia ESPERADO (segunda -> sexta 25/09)", async () => {
    const m = await novoMotorista(contaComConfig);
    const r = await testar(contaComConfig, m.id);
    expect(r).toMatchObject({ enviado: true, diaPerguntado: "2026-09-25", linhaCriada: true });
  });

  it("(a3) empresa com a conferência DESLIGADA e em sombra: o teste sai mesmo assim", async () => {
    const m = await novoMotorista(contaDesligada);
    const r = await testar(contaDesligada, m.id);
    expect(r).toMatchObject({ enviado: true, estado: "ENVIADA" });
  });

  it("(b) com linha RESPONDIDA: zera, reenvia, conta como reenvio e preserva o histórico na trilha", async () => {
    const m = await novoMotorista(contaComConfig);
    await comConta(contaComConfig, () =>
      prisma.conferenciaDiaria.create({
        data: {
          motoristaId: m.id,
          dia: DIA_SEGUNDA,
          estado: "RESPONDIDA",
          opcao: "NAO_TIVE",
          wamid: "wamid.VELHO",
          enviadaEm: new Date("2026-09-28T12:00:00Z"),
          respondidaEm: new Date("2026-09-28T12:01:00Z"),
          respostaTexto: "Não tive",
          motivo: "job",
          snapshot: { evidencias: { diasEsperadosVerificados: ["2026-09-25"] } },
          trilha: [{ em: "2026-09-28T12:01:00.000Z", evento: "TOQUE", detalhe: { opcao: "NAO_TIVE" } }],
        } as never,
      }),
    );
    envio.tentarEnviar.mockResolvedValueOnce({ enviado: true, idExterno: "wamid.NOVO" });
    const r = await testar(contaComConfig, m.id);
    expect(r).toMatchObject({ enviado: true, estado: "ENVIADA", reenvios: 1, linhaCriada: false, wamid: "wamid.NOVO", diaPerguntado: "2026-09-25" });

    const [l] = await linhasDe(contaComConfig, m.id);
    expect(l).toMatchObject({ estado: "ENVIADA", opcao: null, respondidaEm: null, respostaTexto: null, wamid: "wamid.NOVO", reenvios: 1 });
    expect(eventos(l!.trilha)).toEqual(["TOQUE", "TESTE", "ENVIO"]);
    expect((l!.trilha as { detalhe: Record<string, any> }[])[1]!.detalhe.antes).toMatchObject({ estado: "RESPONDIDA", opcao: "NAO_TIVE", wamid: "wamid.VELHO" });
    // Era uma pergunta de verdade do job: continua contando como tal.
    expect(l!.snapshot).not.toHaveProperty("origem");
  });

  it("(b2) linha SUPRIMIDA pela regra NÃO bloqueia o teste: vira teste, com o dia perguntado; e o limite por dia vale", async () => {
    const m = await novoMotorista(contaComConfig);
    await comConta(contaComConfig, () =>
      prisma.conferenciaDiaria.create({
        data: { motoristaId: m.id, dia: DIA_SEGUNDA, estado: "SUPRIMIDA", motivo: "Lançou viagem em 25/09/2026.", snapshot: { deveriaPerguntar: false, evidencias: {} } } as never,
      }),
    );
    const r = await testar(contaComConfig, m.id);
    expect(r).toMatchObject({ enviado: true, estado: "ENVIADA", linhaCriada: false, reenvios: 1 });
    const [l] = await linhasDe(contaComConfig, m.id);
    expect(l!.snapshot).toMatchObject({ origem: "TESTE_PAINEL", evidencias: { diasEsperadosVerificados: ["2026-09-25"] } });
    expect(l!.suprimidaPor).toBeNull();

    for (let i = 1; i < PADRAO_MAX_REENVIOS_POR_PERGUNTA; i++) await testar(contaComConfig, m.id);
    await expect(testar(contaComConfig, m.id)).rejects.toThrow(/vezes/);
    expect((await linhasDe(contaComConfig, m.id))[0]!.reenvios).toBe(PADRAO_MAX_REENVIOS_POR_PERGUNTA);
  });

  it("(b3) a Meta recusa: a linha criada fica FALHOU com o motivo e a resposta diz que não saiu", async () => {
    const m = await novoMotorista(contaComConfig);
    envio.tentarEnviar.mockResolvedValueOnce({ enviado: false, erro: { tipo: "POLITICA", codigo: "META_131026", detalhe: "não entregue" } });
    const r = await testar(contaComConfig, m.id);
    expect(r).toMatchObject({ enviado: false, estado: "FALHOU", erro: "META_131026: não entregue", wamid: null });
  });

  it("(c) sem canal ou sem Meta: recusa com o motivo e NÃO grava nada nem envia", async () => {
    envio.tentarEnviar.mockClear();
    const casos: [string, Record<string, unknown>, RegExp][] = [
      ["sem telefone", { telefone: null }, /não tem telefone cadastrado/],
      ["não aceita WhatsApp", { aceitaWhatsapp: false }, /desligou as mensagens no WhatsApp/],
      ["pediu pra parar", { receberConferenciaDiaria: false }, /pediu pra parar/],
      ["desligada pelo painel", { receberConferenciaDiaria: false, conferenciaDesligadaOrigem: "PAINEL" }, /desligada pela empresa/],
      ["número suspeito", { whatsappInalcancavelEm: new Date() }, /sem entregar/],
    ];
    for (const [, over, msg] of casos) {
      const m = await novoMotorista(contaComConfig, over);
      await expect(testar(contaComConfig, m.id)).rejects.toThrow(msg);
      await expect(testar(contaComConfig, m.id)).rejects.toBeInstanceOf(ConflictException);
      expect(await linhasDe(contaComConfig, m.id)).toHaveLength(0);
    }
    const ok = await novoMotorista(contaComConfig);
    envio.disponivel.mockResolvedValueOnce({ ok: false, motivo: "Meta não configurada." });
    await expect(testar(contaComConfig, ok.id)).rejects.toThrow(/não está disponível agora: Meta não configurada\./);
    expect(await linhasDe(contaComConfig, ok.id)).toHaveLength(0);
    expect(envio.tentarEnviar).not.toHaveBeenCalled();
  });

  it("(d) o teste NÃO conta no intervalo mínimo nem no máximo semanal; uma pergunta do job conta", async () => {
    const teste = await novoMotorista(contaComConfig);
    const real = await novoMotorista(contaComConfig);
    // Domingo 27/09 tem a pergunta (uma de teste, outra do job); segunda 28/09 é "hoje" (1 dia depois).
    const ONTEM = new Date("2026-09-27T12:00:00Z");
    await testar(contaComConfig, teste.id, ONTEM);
    await comConta(contaComConfig, () =>
      prisma.conferenciaDiaria.create({
        data: { motoristaId: real.id, dia: inicioDoDiaData(ONTEM), estado: "ENVIADA", motivo: "job", snapshot: { evidencias: {} } } as never,
      }),
    );
    const cfg = await comConta(contaComConfig, () => prisma.configuracaoConferenciaDiaria.findFirstOrThrow());
    const itens = await comConta(contaComConfig, () => (servico as never as { calcular: (c: unknown, a: Date) => Promise<any[]> }).calcular(cfg, SEGUNDA));
    const doTeste = itens.find((i) => i.motoristaId === teste.id);
    const doJob = itens.find((i) => i.motoristaId === real.id);
    expect(doTeste.deveriaPerguntar).toBe(true);
    expect(doTeste.evidencias.ultimaPergunta).toBeNull();
    expect(doTeste.evidencias.perguntasNaSemana).toBe(0);
    // Contraste: a pergunta de verdade do mesmo dia trava a nova (intervalo de 3 dias).
    expect(doJob.deveriaPerguntar).toBe(false);
    expect(doJob.motivo).toMatch(/Já foi perguntado/);
  });

  it("(d2) linha de teste gravada HOJE não faz o job pular o dia dos outros motoristas", async () => {
    const testador = await novoMotorista(contaOutra);
    const outro = await novoMotorista(contaOutra);
    await comConta(contaOutra, () =>
      prisma.configuracaoConferenciaDiaria.create({ data: { ativo: true, modo: "SOMBRA", horaEnvio: 9 } as never }),
    );
    await testar(contaOutra, testador.id);
    const cfg = await comConta(contaOutra, () => prisma.configuracaoConferenciaDiaria.findFirstOrThrow());
    const gravadas = await comConta(contaOutra, () =>
      (servico as never as { gravarODia: (c: unknown, conta: string, a: Date) => Promise<number> }).gravarODia(cfg, contaOutra, SEGUNDA),
    );
    // O job rodou (não achou "o dia já foi gravado"): o outro motorista ganhou a linha dele.
    expect(gravadas).toBeGreaterThanOrEqual(1);
    expect(await linhasDe(contaOutra, outro.id)).toHaveLength(1);
    // E o job não pega a linha de teste (enviarPendentes ignora TESTE_PAINEL).
    envio.tentarEnviar.mockClear();
    await comConta(contaOutra, () => prisma.conferenciaDiaria.updateMany({ where: { motoristaId: testador.id }, data: { estado: "PENDENTE" } }));
    await comConta(contaOutra, () => servico.enviarPendentes({ ...cfg, modo: "ENVIANDO" } as never, SEGUNDA));
    expect(envio.tentarEnviar).not.toHaveBeenCalled();
    const [lt] = await linhasDe(contaOutra, testador.id);
    expect(lt!.estado).toBe("PENDENTE"); // intocada pelo job
  });

  describe("(g) Perguntar sobre este dia (corpo { dia })", () => {
    const textoDoEnvio = () => (envio.tentarEnviar.mock.calls.at(-1)![0] as { params: string[]; texto: string });
    const trilhaDe = async (contaId: string, id: string) => (await linhasDe(contaId, id))[0]!.trilha as { evento: string; detalhe: Record<string, any> }[];

    it("(g1) dia passado válido: cria a linha de HOJE, o dia perguntado é o escolhido e o texto cita a data", async () => {
      const m = await novoMotorista(contaComConfig);
      envio.tentarEnviar.mockClear();
      const r = await comConta(contaComConfig, () => servico.enviarPerguntaDeTeste(m.id, admin, SEGUNDA, "2026-09-22"));
      expect(r).toMatchObject({ enviado: true, estado: "ENVIADA", diaPerguntado: "2026-09-22", linhaCriada: true });
      const [l] = await linhasDe(contaComConfig, m.id);
      expect(l!.dia.toISOString()).toBe(DIA_SEGUNDA.toISOString()); // a linha do job segue sendo a de hoje
      expect(l!.snapshot).toMatchObject({ origem: "TESTE_PAINEL", evidencias: { diasEsperadosVerificados: ["2026-09-22"] } });
      expect(textoDoEnvio().params[0]).toContain("22/09");
      expect(textoDoEnvio().texto).toMatch(/22\/09/);
      const aud = await prisma.auditLog.findMany({ where: { entidade: "ConferenciaDiaria", entidadeId: l!.id } });
      expect(aud[0]!.acao).toBe("CONFERENCIA_PERGUNTA_TESTE");
      expect((aud[0]!.metadata as Record<string, unknown>).dia).toBe("2026-09-22");
    });

    it("(g2) hoje, futuro, velho demais e formato inválido: 400 sem envio e sem linha", async () => {
      const m = await novoMotorista(contaComConfig);
      envio.tentarEnviar.mockClear();
      for (const ruim of ["2026-09-28", "2026-09-29", "2027-01-01", "2026-07-29", "2026-02-30", "ontem", ""]) {
        await expect(comConta(contaComConfig, () => servico.enviarPerguntaDeTeste(m.id, admin, SEGUNDA, ruim))).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(envio.tentarEnviar).not.toHaveBeenCalled();
      expect(await linhasDe(contaComConfig, m.id)).toHaveLength(0);
      // O limite da janela (60 dias) passa.
      const ok = await comConta(contaComConfig, () => servico.enviarPerguntaDeTeste(m.id, admin, SEGUNDA, "2026-07-30"));
      expect(ok.diaPerguntado).toBe("2026-07-30");
    });

    it("(g3) segundo teste com OUTRO dia zera a linha e preserva o dia antigo na trilha; o calendário mostra o mais recente", async () => {
      const m = await novoMotorista(contaComConfig);
      await comConta(contaComConfig, () => servico.enviarPerguntaDeTeste(m.id, admin, SEGUNDA, "2026-09-22"));
      // O motorista respondeu à primeira.
      await comConta(contaComConfig, () =>
        prisma.conferenciaDiaria.updateMany({ where: { motoristaId: m.id }, data: { estado: "RESPONDIDA", opcao: "NAO_TIVE", respondidaEm: new Date("2026-09-28T12:05:00Z") } }),
      );
      const r = await comConta(contaComConfig, () => servico.enviarPerguntaDeTeste(m.id, admin, SEGUNDA, "2026-09-24"));
      expect(r).toMatchObject({ diaPerguntado: "2026-09-24", reenvios: 1, linhaCriada: false, estado: "ENVIADA" });
      expect(textoDoEnvio().params[0]).toContain("24/09");
      const linhas = await linhasDe(contaComConfig, m.id);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ opcao: null, respondidaEm: null });
      expect(linhas[0]!.snapshot).toMatchObject({ evidencias: { diasEsperadosVerificados: ["2026-09-24"] }, diasPerguntadosAntes: ["2026-09-22"] });
      const teste = (await trilhaDe(contaComConfig, m.id)).filter((e) => e.evento === "TESTE");
      expect(teste).toHaveLength(2);
      expect(teste[1]!.detalhe).toMatchObject({ diaPerguntado: "2026-09-24", diaEscolhido: true });
      expect(teste[1]!.detalhe.antes).toMatchObject({ estado: "RESPONDIDA", opcao: "NAO_TIVE", diaPerguntado: "2026-09-22" });

      const cal = await comConta(contaComConfig, () => servico.calendarioDoMotorista(m.id, "2026-09", SEGUNDA, true));
      expect(cal.dias).toHaveLength(30);
      expect(cal.dias.find((d) => d.dia === "2026-09-24")!.pergunta).toMatchObject({ estado: "ENVIADA", linhaDia: "2026-09-28" });
      // O dia antigo NÃO some: vira "teste anterior", com o que o motorista respondeu.
      expect(cal.dias.find((d) => d.dia === "2026-09-22")!.pergunta).toMatchObject({ historica: true, estado: "RESPONDIDA", resposta: "NAO_TIVE" });
      expect(linhas[0]!.snapshot).toMatchObject({ perguntasAnteriores: [{ dia: "2026-09-22", estado: "RESPONDIDA", opcao: "NAO_TIVE" }] });
      expect(cal.dias.find((d) => d.dia === "2026-09-10")).toMatchObject({ lancou: false, viagens: 0 });
    });

    it("(g4) o teste do topo (sem dia) depois de um dia escolhido volta ao último dia útil, sem herdar o dia velho", async () => {
      const m = await novoMotorista(contaComConfig);
      await comConta(contaComConfig, () => servico.enviarPerguntaDeTeste(m.id, admin, SEGUNDA, "2026-09-22"));
      const r = await testar(contaComConfig, m.id);
      expect(r.diaPerguntado).toBe("2026-09-25");
      expect(textoDoEnvio().params[0]).toContain("25/09");
      expect((await linhasDe(contaComConfig, m.id))[0]!.snapshot).toMatchObject({ evidencias: { diasEsperadosVerificados: ["2026-09-25"] } });
    });

    it("(g5) linha de pergunta de verdade do job: com dia escolhido, o dia muda e o dia do job vai pra trilha/snapshot; a linha segue sendo do job", async () => {
      const m = await novoMotorista(contaComConfig);
      await comConta(contaComConfig, () =>
        prisma.conferenciaDiaria.create({
          data: { motoristaId: m.id, dia: DIA_SEGUNDA, estado: "ENVIADA", motivo: "job", enviadaEm: SEGUNDA, snapshot: { evidencias: { diasEsperadosVerificados: ["2026-09-25"] } } } as never,
        }),
      );
      const r = await comConta(contaComConfig, () => servico.enviarPerguntaDeTeste(m.id, admin, SEGUNDA, "2026-09-23"));
      expect(r.diaPerguntado).toBe("2026-09-23");
      const [l] = await linhasDe(contaComConfig, m.id);
      expect(l!.snapshot).toMatchObject({ evidencias: { diasEsperadosVerificados: ["2026-09-23"] }, diasPerguntadosAntes: ["2026-09-25"] });
      expect(l!.snapshot).not.toHaveProperty("origem");
    });

    it("(g6) motorista sem canal: recusa com o motivo mesmo com dia escolhido, sem gravar nem enviar", async () => {
      const m = await novoMotorista(contaComConfig, { telefone: null });
      envio.tentarEnviar.mockClear();
      await expect(comConta(contaComConfig, () => servico.enviarPerguntaDeTeste(m.id, admin, SEGUNDA, "2026-09-22"))).rejects.toThrow(/não tem telefone cadastrado/);
      expect(await linhasDe(contaComConfig, m.id)).toHaveLength(0);
      expect(envio.tentarEnviar).not.toHaveBeenCalled();
    });

    it("(g7) escopo: outra empresa = 404 pelo controller com corpo; o corpo é validado pelo Zod (dia não-string = 400)", async () => {
      const deOutra = await novoMotorista(contaOutra);
      const motoristasStub = {
        findOne: async (id: string) => {
          const x = await prisma.motorista.findFirst({ where: { id } });
          if (!x) throw new NotFoundException("Motorista não encontrado");
          return x;
        },
      };
      const c = new ConferenciaDiariaController(servico, {} as never, motoristasStub as never);
      envio.tentarEnviar.mockClear();
      await expect(comConta(contaComConfig, () => c.perguntaDeTeste(deOutra.id, { id: admin, escopo: null } as never, { dia: "2026-09-22" }))).rejects.toBeInstanceOf(NotFoundException);
      expect(envio.tentarEnviar).not.toHaveBeenCalled();
      const pipe = new ZodValidationPipe(PerguntaDeTesteSchema.optional());
      expect(() => pipe.transform({ dia: 20260922 }, {} as never)).toThrow();
      expect(pipe.transform(undefined, {} as never)).toBeUndefined();
      expect(pipe.transform({}, {} as never)).toEqual({});
      expect(pipe.transform({ dia: "2026-09-22" }, {} as never)).toEqual({ dia: "2026-09-22" });
    });
  });

  describe("(e)(f) escopo, permissão e módulo", () => {
    const motoristasStub = {
      // Mesmo contrato do MotoristasService.findOne: fora do escopo/conta = 404.
      findOne: async (id: string) => {
        const m = await prisma.motorista.findFirst({ where: { id } });
        if (!m) throw new NotFoundException("Motorista não encontrado");
        return m;
      },
    };
    const ctrl = () => new ConferenciaDiariaController(servico, {} as never, motoristasStub as never);

    it("(e) motorista de OUTRA empresa = 404 e nada é enviado, pelo controller e pelo serviço", async () => {
      const deOutra = await novoMotorista(contaOutra);
      envio.tentarEnviar.mockClear();
      await expect(
        comConta(contaComConfig, () => ctrl().perguntaDeTeste(deOutra.id, { id: admin, escopo: null } as never)),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(testar(contaComConfig, deOutra.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(envio.tentarEnviar).not.toHaveBeenCalled();
      expect(await linhasDe(contaOutra, deOutra.id)).toHaveLength(0);
    });

    it("(f) a rota exige conferencia-diaria.decidir (de onde o ModuloGuard deriva o módulo `conferencia`)", () => {
      const exigidas = Reflect.getMetadata(PERMISSAO_KEY, ConferenciaDiariaController.prototype.perguntaDeTeste) as string[];
      expect(exigidas).toEqual(["conferencia-diaria.decidir"]);
      expect(moduloDaChave(exigidas[0]!)).toBe("conferencia");
    });

    it("(f) o PermissaoGuard barra quem só tem `ver` e libera quem tem `decidir`", () => {
      const guard = new PermissaoGuard(new Reflector());
      const contexto = (permissoes: string[]) =>
        ({
          getHandler: () => ConferenciaDiariaController.prototype.perguntaDeTeste,
          getClass: () => ConferenciaDiariaController,
          switchToHttp: () => ({ getRequest: () => ({ user: { kind: "ADMIN_USER", permissoes } }) }),
        }) as unknown as ExecutionContext;
      expect(() => guard.canActivate(contexto(["conferencia-diaria.ver"]))).toThrow(ForbiddenException);
      expect(guard.canActivate(contexto(["conferencia-diaria.ver", "conferencia-diaria.decidir"]))).toBe(true);
    });
  });
});
