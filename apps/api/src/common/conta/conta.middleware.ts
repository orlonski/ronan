import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { abrirContexto } from "./conta-context";

/**
 * Abre o contexto de conta (ainda vazio) no começo de TODA requisição.
 *
 * Precisa ser middleware, não interceptor nem guard: só o middleware roda cedo
 * o bastante pra envolver guards, interceptors e handler dentro do mesmo
 * `AsyncLocalStorage.run` — e os guards já consultam o banco (o `JwtStrategy` é
 * quem descobre a conta). Um interceptor rodaria tarde demais e o JwtStrategy
 * ficaria de fora do contexto que ele mesmo precisa preencher.
 *
 * Nasce com `contaId: null`, o que faz a trava recusar qualquer consulta até
 * alguém dizer de quem é. É o comportamento certo: rota que não identifica a
 * conta não deveria estar lendo dado de negócio.
 */
@Injectable()
export class ContaMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    abrirContexto(() => next());
  }
}
