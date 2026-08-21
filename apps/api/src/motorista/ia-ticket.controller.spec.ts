import { describe, it, expect, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { IaTicketController } from "./ia-ticket.controller";
import type { IaService } from "../ia/ia.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthMotorista } from "../auth/types";

/**
 * Duas travas em série protegem a leitura de ticket, e elas respondem a
 * perguntas diferentes:
 *
 *   1. a PLATAFORMA liberou esta empresa? (`Conta.iaLeituraTicket`) — quem paga
 *      a chamada é a plataforma, então é dela a decisão;
 *   2. o rollout chegou neste motorista? (`Motorista.podeUsarOcrTicket`, no
 *      AcessoMotoristaGuard) — decisão da empresa, dentro do que foi liberado.
 *
 * O teste aqui é da primeira. Esconder o botão no app não vale como trava: é
 * este controller que recusa a chamada de fato.
 */

const MOTORISTA = { id: "m1", contaId: "conta-a" } as AuthMotorista;
const CORPO = { fotoBase64: "/9j/4AAQ", mime: "image/jpeg" };

function montar(opts: { iaLeituraTicket: boolean | null; iaHabilitada?: boolean }) {
  const extrairTicket = vi.fn().mockResolvedValue({ confidence: 0.9 });
  const ia = {
    get habilitada() {
      return opts.iaHabilitada ?? true;
    },
    extrairTicket,
  } as unknown as IaService;

  const prisma = {
    conta: {
      findUnique: vi.fn().mockResolvedValue(
        opts.iaLeituraTicket === null ? null : { iaLeituraTicket: opts.iaLeituraTicket },
      ),
    },
    motorista: { findUnique: vi.fn().mockResolvedValue({ veiculos: [] }) },
    cliente: { findMany: vi.fn().mockResolvedValue([]) },
    material: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

  return { controller: new IaTicketController(ia, prisma), extrairTicket, prisma };
}

describe("POST /m/ia/extrair-ticket — trava da plataforma", () => {
  it("empresa não liberada: recusa com 403 e NÃO chama a IA", async () => {
    const { controller, extrairTicket } = montar({ iaLeituraTicket: false });

    const erro = await controller.extrair(MOTORISTA, CORPO).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(HttpException);
    expect((erro as HttpException).getStatus()).toBe(403);
    // O que importa de verdade: nenhum token foi gasto.
    expect(extrairTicket).not.toHaveBeenCalled();
  });

  it("a mensagem diz que é da empresa, não que o serviço caiu", async () => {
    const { controller } = montar({ iaLeituraTicket: false });
    const erro = (await controller.extrair(MOTORISTA, CORPO).catch((e: unknown) => e)) as HttpException;
    expect(String(erro.getResponse())).toMatch(/empresa/i);
  });

  it("empresa liberada: a chamada segue", async () => {
    const { controller, extrairTicket } = montar({ iaLeituraTicket: true });

    const r = await controller.extrair(MOTORISTA, CORPO);

    expect(r).toEqual({ confidence: 0.9 });
    expect(extrairTicket).toHaveBeenCalledOnce();
  });

  it("a trava da empresa vem ANTES do estado da IA — 403, não 503", async () => {
    // Pra empresa que não tem o recurso, se a chave da Anthropic está
    // configurada ou não é irrelevante, e não é algo que ela deva sondar.
    const { controller, extrairTicket } = montar({
      iaLeituraTicket: false,
      iaHabilitada: false,
    });

    const erro = (await controller.extrair(MOTORISTA, CORPO).catch((e: unknown) => e)) as HttpException;

    expect(erro.getStatus()).toBe(403);
    expect(extrairTicket).not.toHaveBeenCalled();
  });

  it("empresa liberada mas IA fora do ar: aí sim 503", async () => {
    const { controller } = montar({ iaLeituraTicket: true, iaHabilitada: false });
    const erro = (await controller.extrair(MOTORISTA, CORPO).catch((e: unknown) => e)) as HttpException;
    expect(erro.getStatus()).toBe(503);
  });

  it("conta que sumiu do banco é tratada como NÃO liberada", async () => {
    // Fail-closed: na dúvida não gasta. O contrário deixaria um contaId órfão
    // no token virar chamada paga.
    const { controller, extrairTicket } = montar({ iaLeituraTicket: null });

    const erro = (await controller.extrair(MOTORISTA, CORPO).catch((e: unknown) => e)) as HttpException;

    expect(erro.getStatus()).toBe(403);
    expect(extrairTicket).not.toHaveBeenCalled();
  });

  it("a consulta da trava é feita com a conta do TOKEN, não com algo do corpo", async () => {
    const { controller, prisma } = montar({ iaLeituraTicket: true });

    await controller.extrair(MOTORISTA, CORPO);

    expect(prisma.conta.findUnique).toHaveBeenCalledWith({
      where: { id: "conta-a" },
      select: { iaLeituraTicket: true },
    });
  });
});
