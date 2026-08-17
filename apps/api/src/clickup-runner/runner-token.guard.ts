import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { RunnerConfig } from "./runner.config";
import { segredoConfere } from "../common/seguranca/segredo";

export { segredoConfere };

/**
 * Autenticação do webhook: header `X-Runner-Token` + (opcional) segmento
 * secreto no path. O valor recebido NUNCA é logado — nem em erro.
 */
@Injectable()
export class RunnerTokenGuard implements CanActivate {
  constructor(private readonly config: RunnerConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    // Runner desligado: recusa tudo (o endpoint existe, mas não aceita nada).
    if (!this.config.habilitado) throw new UnauthorizedException("Runner não habilitado");

    // Path não-adivinhável: quando configurado, o segmento secreto é obrigatório.
    const segredoUrl = (req.params as Record<string, string> | undefined)?.segredo;
    if (this.config.segredoPath) {
      if (!segredoConfere(segredoUrl, this.config.segredoPath)) {
        throw new UnauthorizedException("Token inválido");
      }
    } else if (segredoUrl) {
      // Sem segredo configurado, a rota com prefixo não vale.
      throw new UnauthorizedException("Token inválido");
    }

    const header = req.headers["x-runner-token"];
    const recebido = Array.isArray(header) ? header[0] : header;
    if (!segredoConfere(recebido, this.config.token)) {
      throw new UnauthorizedException("Token inválido");
    }
    return true;
  }
}
