import { CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import { ContadorJanela } from "./contador-janela";
import { ipDaRequisicao } from "./ip";

/**
 * Cria um guard de rate limit por IP (janela de 1 minuto) já INSTANCIADO.
 *
 * Devolve instância em vez de classe porque o Nest aceita instância em
 * `@UseGuards(...)` — assim o limite é declarado no próprio controller, sem
 * provider, sem DI e sem um módulo inteiro só pra configurar um número.
 *
 * Cada chamada tem contador próprio: dois endpoints com limites diferentes não
 * competem pela mesma cota.
 */
export function criarRateLimitIpGuard(opcoes: {
  limitePorMinuto: number;
  /** Só pra deixar o guard identificável em stack trace/debug. */
  nome: string;
}): CanActivate {
  const contador = new ContadorJanela();

  return {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<Request>();
      const total = contador.registrar(ipDaRequisicao(req));
      if (total > opcoes.limitePorMinuto) {
        throw new HttpException("Muitas requisições", HttpStatus.TOO_MANY_REQUESTS);
      }
      return true;
    },
  };
}
