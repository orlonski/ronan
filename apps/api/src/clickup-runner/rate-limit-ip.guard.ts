import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { ContadorJanela } from "../common/rate-limit/contador-janela";
import { ipDaRequisicao } from "../common/rate-limit/ip";
import { RunnerConfig } from "./runner.config";

// Re-export: o limite deste guard vem do RunnerConfig (env), então ele continua
// sendo uma classe com DI, ao contrário do `criarRateLimitIpGuard` genérico.
// `ipDaRequisicao` mora em common/ desde que o link público passou a precisar
// dele; segue exportado daqui pra não mexer em quem já importava.
export { ipDaRequisicao };

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
  private readonly contador = new ContadorJanela();

  constructor(private readonly config: RunnerConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const total = this.contador.registrar(ipDaRequisicao(req));

    if (total > this.config.rateLimitPorMinuto) {
      throw new HttpException("Muitas requisições", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
