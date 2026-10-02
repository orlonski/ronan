import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { comConta } from "../common/conta/conta-context";
import { tokenWebhookConfere } from "./segredo-asaas";

/**
 * Formato de id de conta. NÃO é só UUID: a primeira conta (Schaba) nasceu com
 * id fixo `cnt_schaba` na migração do multi-empresa.
 */
const ID_CONTA = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A porta do webhook do Asaas DE UMA TRANSPORTADORA.
 *
 * A rota é `@Public()` (quem chama é a máquina do Asaas, sem JWT), então este
 * guard é a ÚNICA coisa entre a internet e "declarar fatura paga". Fail-closed
 * em tudo: conta inexistente, conta sem conexão, token ausente ou diferente —
 * 401, e a resposta é a mesma pros quatro casos (dizer "essa conta existe mas o
 * token está errado" ajudaria quem está tentando adivinhar).
 *
 * O token é POR CONTA: o da transportadora A não abre a rota da B, nem que
 * alguém troque o `:contaId` da URL.
 */
@Injectable()
export class WebhookCobrancaClienteGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const contaId = String(req.params?.contaId ?? "");
    const header = req.headers["asaas-access-token"];
    const recebido = Array.isArray(header) ? header[0] : header;

    if (!ID_CONTA.test(contaId) || !recebido) throw new UnauthorizedException("Token inválido.");

    const conexao = await comConta(contaId, () =>
      this.prisma.conexaoAsaas.findFirst({ select: { webhookTokenHash: true } }),
    );
    if (!conexao || !tokenWebhookConfere(recebido, conexao.webhookTokenHash)) {
      throw new UnauthorizedException("Token inválido.");
    }
    return true;
  }
}
