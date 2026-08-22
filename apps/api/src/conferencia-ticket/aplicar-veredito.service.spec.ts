import { describe, it, expect, vi, beforeEach } from "vitest";
import { StatusViagem } from "@prisma/client";
import { AplicarVereditoService } from "./aplicar-veredito.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PushService } from "../push/push.service";
import type { ConferenciaFilaService } from "./conferencia-fila.service";
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

function montar() {
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
  return { svc: new AplicarVereditoService(prisma, fila, push), prisma, fila, push, updateMany };
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
    // Auto-aprovar sem revisadoEm faria o FechamentoProcessor sobrescrever
    // depois; com revisadoEm seria o robô assinando por um humano. O selo de
    // conferido vem da tabela de conferência, no painel.
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
