import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { segredoConfere } from "../common/seguranca/segredo";
import { InstagramConfig } from "./instagram.config";

/**
 * Autenticação da ingestão de posts vinda do `ronan_agente`.
 *
 * Segredo compartilhado em vez de JWT porque quem chama é um processo, não uma
 * pessoa: não há sessão pra renovar nem usuário pra expirar. É o mesmo desenho
 * do webhook do ClickUp, e pelo mesmo motivo.
 *
 * A chamada não sai da rede interna do Docker (`ronan-api:3000`), então o
 * segredo não trafega pela internet. Ainda assim é comparado em tempo
 * constante e nunca aparece em log — nem quando falha.
 *
 * Sem `MARKETING_INGEST_TOKEN` configurado o endpoint recusa tudo. Nasce
 * fechado: um endpoint que aceita conteúdo pro feed da marca não pode existir
 * por acidente.
 */
@Injectable()
export class IngestaoTokenGuard implements CanActivate {
  constructor(private readonly config: InstagramConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.ingestaoHabilitada) {
      throw new UnauthorizedException("Ingestão não habilitada");
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers["x-marketing-token"];
    const recebido = Array.isArray(header) ? header[0] : header;
    if (!segredoConfere(recebido, this.config.ingestToken)) {
      throw new UnauthorizedException("Token inválido");
    }
    return true;
  }
}
