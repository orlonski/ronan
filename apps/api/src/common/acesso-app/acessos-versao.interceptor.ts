import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { from, type Observable, switchMap } from "rxjs";
import type { AuthUser } from "../../auth/types";
import { PrismaService } from "../../prisma/prisma.service";
import { CachePorConta } from "../conta/cache-por-conta";

/**
 * `x-acessos-versao: <contaId>:<versao>` em toda resposta `/m/*` de quem tem
 * empresa (motorista ou funcionário).
 *
 * A `versao` sobe sempre que o acesso calculado de alguém da empresa muda
 * (ver `AcessoAppService.gravar`). O app compara com a última que viu e, se
 * subiu, revalida o `GET /m/eu/acessos` em segundo plano. É o que faz o
 * "tirei o chat dele" chegar no celular na próxima requisição qualquer, sem
 * polling e sem esperar ele fechar e abrir o app.
 *
 * O contaId vai junto porque a versão é POR EMPRESA: a mesma pessoa roda pra
 * mais de uma, e o "3" de uma não tem nada a ver com o "3" da outra.
 *
 * Cache de 15s por conta: roda em toda requisição do app, e um select a mais
 * em cada uma é imposto sem motivo. Os 15s são o atraso máximo do aviso.
 */
@Injectable()
export class AcessosVersaoInterceptor implements NestInterceptor {
  private readonly cache = new CachePorConta<number | null>("acessos-versao", 15_000);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<{ user?: AuthUser; path?: string; url?: string }>();
    const res = http.getResponse<{ setHeader?: (k: string, v: string) => void; headersSent?: boolean }>();
    const user = req.user;
    const rota = req.path ?? req.url ?? "";
    if (!rota.startsWith("/m/") || (user?.kind !== "MOTORISTA" && user?.kind !== "FUNCIONARIO")) {
      return next.handle();
    }
    const contaId = user.contaId;
    return from(
      this.cache
        .obter(
          async (conta) =>
            (
              await this.prisma.configuracaoAcessoApp.findUnique({
                where: { contaId: conta },
                select: { versao: true },
              })
            )?.versao ?? null,
          null,
        )
        .then((versao) => {
          // Um aviso a menos nunca derruba resposta: sem versão, sem cabeçalho.
          if (versao !== null && res.setHeader && !res.headersSent) {
            res.setHeader("x-acessos-versao", `${contaId}:${versao}`);
          }
        })
        .catch(() => undefined),
    ).pipe(switchMap(() => next.handle()));
  }
}
