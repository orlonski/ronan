import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { RunnerConfig } from "./runner.config";

/**
 * Compara dois segredos em tempo constante. Compara o SHA-256 dos dois (não o
 * texto): `timingSafeEqual` exige buffers do mesmo tamanho, e comparar tamanho
 * antes já vazaria o comprimento do segredo.
 */
export function segredoConfere(recebido: string | undefined, esperado: string): boolean {
  if (!esperado || !recebido) return false;
  const a = createHash("sha256").update(recebido, "utf8").digest();
  const b = createHash("sha256").update(esperado, "utf8").digest();
  return timingSafeEqual(a, b);
}

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
