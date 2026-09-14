import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { segredoConfere } from "../common/seguranca/segredo";
import { AsaasConfig } from "./asaas.config";

/**
 * A autenticação do webhook do gateway: o header `asaas-access-token`.
 *
 * É a ÚNICA porta dessa rota — ela é `@Public()`, como todo webhook, porque
 * quem chama é máquina e não tem JWT. Sem este guard, qualquer um na internet
 * poderia declarar mensalidades como pagas.
 *
 * Nasce FECHADO: sem `ASAAS_WEBHOOK_TOKEN` configurado a rota recusa tudo, em
 * vez de aceitar tudo. É a mesma postura do runner do ClickUp, e a inversa do
 * `PermissaoGuard` — aqui fail-open não é uma dívida, seria um convite.
 *
 * O valor recebido nunca é logado, nem em erro.
 */
@Injectable()
export class AsaasWebhookGuard implements CanActivate {
  constructor(private readonly config: AsaasConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.webhookHabilitado) {
      throw new UnauthorizedException("Webhook de pagamento não habilitado.");
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers["asaas-access-token"];
    const recebido = Array.isArray(header) ? header[0] : header;

    // Comparação em tempo constante: comparar segredo com === vaza o tamanho do
    // prefixo certo pra quem mede o tempo da resposta.
    if (!segredoConfere(recebido, this.config.webhookToken)) {
      throw new UnauthorizedException("Token inválido.");
    }
    return true;
  }
}
