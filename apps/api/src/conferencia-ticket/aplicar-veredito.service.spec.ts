import { describe, it, expect, vi, beforeEach } from "vitest";
import { StatusViagem } from "@prisma/client";
import { AplicarVereditoService } from "./aplicar-veredito.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PushService } from "../push/push.service";
import type { ConferenciaFilaService } from "./conferencia-fila.service";
import type { ConferenciaConfig } from "./conferencia.config";
import type { ResultadoConferencia } from "../common/conferencia-ticket";

const JOB = { id: "j1", viagemId: "v1", contaId: "c1" } as never;

const resultado = (over: Partial<ResultadoConferencia>): ResultadoConferencia => ({
  veredito: "BATE",
  divergencias: [],
  incertezas: [],
  conferidos: ["ticket"],
  ...over,
});

const DIVERGE = resultado({
  veredito: "DIVERGE",
  divergencias: [
    {
      campo: "toneladas",
      declarado: "35,14 t",
      lido: "30,50 t",
      gravidade: "ALTA",
      detalhe: "O ticket mostra 30,50 t e a viagem foi lançada com 35,14 t.",
    },
  ],
});

function montar(cfg: Partial<{ autoAprovar: boolean; confiancaParaAprovar: number; minCamposParaAprovar: number }> = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    viagem: {
      updateMany,
      findUnique: vi.fn().mockResolvedValue({ motoristaId: "m1", motorista: { expoPushToken: "tok" } }),
    },
    viagemMensagem: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
  const fila = { finalizar: vi.fn().mockResolvedValue(undefined) } as unknown as ConferenciaFilaService;
  const push = { enviar: vi.fn().mockResolvedValue(undefined) } as unknown as PushService;
  const config = {
    autoAprovar: cfg.autoAprovar ?? false,
    confiancaParaAprovar: cfg.confiancaParaAprovar ?? 0.9,
    minCamposParaAprovar: cfg.minCamposParaAprovar ?? 3,
  } as ConferenciaConfig;
  return { svc: new AplicarVereditoService(prisma, fila, push, config), prisma, fila, push, updateMany };
}

const dados = (r: ResultadoConferencia) => ({
  resultado: r,
  leitura: { confianca: 0.92 },
  custoUsd: 0.0047,
  modelo: "claude-haiku-4-5-20251001",
  passadas: 1,
  escalou: false,
});

describe("modo sombra (o padrão)", () => {
  it("grava o veredito e NÃO toca na viagem", async () => {
    const { svc, updateMany, push, fila } = montar();

    await svc.aplicar(JOB, dados(DIVERGE), true);

    expect(updateMany).not.toHaveBeenCalled();
    expect(push.enviar).not.toHaveBeenCalled();
    const gravado = (fila.finalizar as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(gravado.veredito).toBe("DIVERGE");
    expect(gravado.acao).toBe("NENHUMA");
    // Sem aplicadoEm dá pra separar "só observou" de "agiu" no histórico.
    expect(gravado.aplicadoEm).toBeNull();
  });

  it("mede o custo mesmo sem agir — é pra isso que a sombra serve", async () => {
    const { svc, fila } = montar();
    await svc.aplicar(JOB, dados(DIVERGE), true);
    const gravado = (fila.finalizar as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(Number(gravado.custoUsd)).toBeCloseTo(0.0047, 6);
    expect(gravado.passadas).toBe(1);
  });
});

describe("atuando", () => {
  it("DIVERGE marca divergente, escreve no chat e avisa — mas NUNCA revisadoEm", async () => {
    // É o teste que impede a regressão mais cara do projeto: revisadoEm
    // preenchido faz o FechamentoProcessor parar de sobrescrever o status, e
    // significa "um humano decidiu". Robô não assina por gente.
    const { svc, updateMany, prisma, push } = montar();

    await svc.aplicar(JOB, dados(DIVERGE), false);

    const escrito = updateMany.mock.calls[0][0].data;
    expect(escrito.status).toBe(StatusViagem.DIVERGENTE);
    expect(escrito).not.toHaveProperty("revisadoEm");
    expect(escrito).not.toHaveProperty("revisadoPor");
    expect(escrito).not.toHaveProperty("revisadoPorId");
    expect(escrito.motivoStatus).toMatch(/30,50/);

    expect(prisma.viagemMensagem.create).toHaveBeenCalledOnce();
    expect(push.enviar).toHaveBeenCalledOnce();
  });

  it("a mensagem no chat é assinada como conferência, sem usuário", async () => {
    const { svc, prisma } = montar();
    await svc.aplicar(JOB, dados(DIVERGE), false);
    const msg = (prisma.viagemMensagem.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(msg.usuarioId).toBeNull();
    expect(msg.autorNome).toBe("Conferência automática");
    expect(msg.acao).toBe("MARCOU_DIVERGENTE");
  });

  it("o texto do push fala com parceiro, não com subordinado", async () => {
    const { svc, push } = montar();
    await svc.aplicar(JOB, dados(DIVERGE), false);
    const enviado = (push.enviar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(enviado.titulo).toMatch(/conferida/i);
    expect(enviado.titulo).not.toMatch(/errad|errou|incorret/i);
  });

  it("INCERTO vai pra revisão humana e NÃO incomoda o motorista", async () => {
    const { svc, updateMany, push } = montar();

    await svc.aplicar(JOB, dados(resultado({ veredito: "INCERTO" })), false);

    expect(updateMany.mock.calls[0][0].data.status).toBe(StatusViagem.EM_CONFERENCIA);
    expect(push.enviar).not.toHaveBeenCalled();
  });

  it("BATE não marca a viagem como OK sozinho", async () => {
    // A aprovação automática nasce desligada: é a ação de maior raio de dano,
    // porque ninguém revisa o que já está aprovado.
    const { svc, updateMany, push, fila } = montar();

    await svc.aplicar(JOB, dados(resultado({ veredito: "BATE" })), false);

    expect(updateMany).not.toHaveBeenCalled();
    expect(push.enviar).not.toHaveBeenCalled();
    expect((fila.finalizar as ReturnType<typeof vi.fn>).mock.calls[0][1].acao).toBe("NENHUMA");
  });

  it("NAO_APLICAVEL não faz nada", async () => {
    const { svc, updateMany } = montar();
    await svc.aplicar(JOB, dados(resultado({ veredito: "NAO_APLICAVEL", conferidos: [] })), false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("só mexe em viagem que ainda está ENVIADA ou AJUSTADA", async () => {
    // A última trava contra corrida: se um humano mexeu entre a leitura e
    // agora, o updateMany não encontra nada e nada acontece.
    const { svc, updateMany } = montar();
    await svc.aplicar(JOB, dados(DIVERGE), false);
    expect(updateMany.mock.calls[0][0].where.status.in).toEqual([
      StatusViagem.ENVIADA,
      StatusViagem.AJUSTADA,
    ]);
  });

  it("viagem que mudou no meio não recebe chat nem push", async () => {
    const { svc, prisma, push } = montar();
    (prisma.viagem.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await svc.aplicar(JOB, dados(DIVERGE), false);

    expect(prisma.viagemMensagem.create).not.toHaveBeenCalled();
    expect(push.enviar).not.toHaveBeenCalled();
  });

  it("falha ao notificar não impede o job de fechar", async () => {
    const { svc, push, fila } = montar();
    (push.enviar as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("expo fora"));

    await svc.aplicar(JOB, dados(DIVERGE), false);

    expect(fila.finalizar).toHaveBeenCalledOnce();
  });
});

/**
 * Aprovar sozinho é a ação de maior raio de dano do sistema — acusar errado
 * incomoda alguém que reclama, aprovar errado passa dinheiro adiante e ninguém
 * revisa o que já está aprovado. Daí os limiares próprios.
 */
describe("aprovação automática", () => {
  const BATE = resultado({
    veredito: "BATE",
    conferidos: ["toneladas", "ticket", "data", "placa"],
  });
  const comConfianca = (r: ResultadoConferencia, c: number) => ({ ...dados(r), leitura: { confianca: c } });

  it("aprova marcando como conferida, do jeito que um humano marcaria", async () => {
    const { svc, updateMany, fila } = montar({ autoAprovar: true });

    await svc.aplicar(JOB, comConfianca(BATE, 0.95), false);

    const escrito = updateMany.mock.calls[0][0].data;
    expect(escrito.status).toBe(StatusViagem.OK);
    // revisadoEm é o que faz o fechamento preservar a decisão em vez de
    // sobrescrever o status — é o ponto de aprovar.
    expect(escrito.revisadoEm).toBeInstanceOf(Date);
    expect((fila.finalizar as ReturnType<typeof vi.fn>).mock.calls[0][1].acao).toBe("APROVOU");
  });

  it("deixa registrado que quem aprovou foi o sistema", async () => {
    // Sem isto a viagem apareceria como revisada e ninguém saberia por quem —
    // pior do que não aprovar.
    const { svc, updateMany, prisma } = montar({ autoAprovar: true });

    await svc.aplicar(JOB, comConfianca(BATE, 0.95), false);

    expect(updateMany.mock.calls[0][0].data.conferidoPorIaEm).toBeInstanceOf(Date);
    const msg = (prisma.viagemMensagem.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(msg.autorNome).toBe("Conferência automática");
    expect(msg.acao).toBe("CONFERIU");
  });

  it("nunca preenche revisadoPor — não há pessoa por trás", async () => {
    const { svc, updateMany } = montar({ autoAprovar: true });
    await svc.aplicar(JOB, comConfianca(BATE, 0.95), false);
    const escrito = updateMany.mock.calls[0][0].data;
    expect(escrito).not.toHaveProperty("revisadoPor");
    expect(escrito).not.toHaveProperty("revisadoPorId");
  });

  it("não aprova com leitura menos confiante que o limiar", async () => {
    // Pra deixar passar sem olho humano tem que estar mais certo do que pra
    // pedir uma conferida.
    const { svc, updateMany } = montar({ autoAprovar: true, confiancaParaAprovar: 0.9 });
    await svc.aplicar(JOB, comConfianca(BATE, 0.85), false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("não aprova quando poucos campos foram realmente conferidos", async () => {
    // Viagem em que só o peso deu pra ler não é uma viagem conferida.
    const { svc, updateMany } = montar({ autoAprovar: true, minCamposParaAprovar: 3 });
    await svc.aplicar(JOB, comConfianca(resultado({ conferidos: ["toneladas"] }), 0.98), false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("não aprova com incerteza pendurada", async () => {
    const { svc, updateMany } = montar({ autoAprovar: true });
    const comIncerteza = resultado({
      conferidos: ["toneladas", "ticket", "data"],
      incertezas: [{ campo: "placa", declarado: "A", lido: "B", motivo: "x" }],
    });
    await svc.aplicar(JOB, comConfianca(comIncerteza, 0.98), false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("não toca em viagem que um humano já revisou", async () => {
    const { svc, updateMany } = montar({ autoAprovar: true });
    await svc.aplicar(JOB, comConfianca(BATE, 0.95), false);
    expect(updateMany.mock.calls[0][0].where.revisadoEm).toBeNull();
  });

  it("desligada, não aprova nada", async () => {
    const { svc, updateMany } = montar({ autoAprovar: false });
    await svc.aplicar(JOB, comConfianca(BATE, 0.99), false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("em modo sombra não aprova nem com tudo ligado", async () => {
    const { svc, updateMany } = montar({ autoAprovar: true });
    await svc.aplicar(JOB, comConfianca(BATE, 0.99), true);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
