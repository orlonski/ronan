import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { RunnerConfig } from "./runner.config";

/**
 * Rate limit por IP na janela de 1 minuto. Em memória de propósito: é defesa
 * contra flood/força-bruta de token, não regra de negócio — se o processo
 * reiniciar e o contador zerar, ninguém se machuca (a correção da fila vive no
 * banco, ver FilaService).
 *
 * Roda ANTES do RunnerTokenGuard pra limitar tentativa de adivinhar o segredo.
 */
@Injectable()
export class RateLimitIpGuard implements CanActivate {
  private readonly janelaMs = 60_000;
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly config: RunnerConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = ipDaRequisicao(req);
    const agora = Date.now();
    const corte = agora - this.janelaMs;

    const recentes = (this.hits.get(ip) ?? []).filter((t) => t > corte);
    recentes.push(agora);
    this.hits.set(ip, recentes);

    // Poda preguiçosa: sem isso o Map cresce pra sempre com IP que sumiu.
    if (this.hits.size > 5_000) {
      for (const [chave, marcas] of this.hits) {
        if (marcas.every((t) => t <= corte)) this.hits.delete(chave);
      }
    }

    if (recentes.length > this.config.rateLimitPorMinuto) {
      throw new HttpException("Muitas requisições", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

/** IP de origem, respeitando proxy (Easypanel/Traefik na frente). */
export function ipDaRequisicao(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const bruto = Array.isArray(fwd) ? fwd[0] : fwd;
  if (bruto) return bruto.split(",")[0]!.trim();
  return req.ip ?? req.socket?.remoteAddress ?? "desconhecido";
}
