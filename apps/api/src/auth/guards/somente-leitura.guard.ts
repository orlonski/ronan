import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { CODIGO_CONTA_SOMENTE_LEITURA } from "../../common/conta/estado-da-conta";
import { PERMITE_SOMENTE_LEITURA } from "../decorators/permite-somente-leitura.decorator";
import type { AuthUser } from "../types";

/** Métodos que mudam alguma coisa. GET e HEAD passam sempre. */
const ESCRITA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Empresa em modo somente leitura não escreve nada.
 *
 * É global e barra por MÉTODO HTTP, não por rota, de propósito: uma lista de
 * endpoints bloqueados envelhece mal — o próximo `POST` que alguém escrever
 * estaria liberado por esquecimento, e o furo só apareceria quando um cliente
 * com teste vencido continuasse lançando viagem.
 *
 * A escolha inversa (barrar na trava do Prisma) pegaria até o que precisa
 * continuar funcionando: carimbar último login, marcar notificação como lida,
 * gravar auditoria. Por isso a régua é o método, com escape explícito via
 * `@PermiteSomenteLeitura()` para o punhado de escritas que são de sessão, e
 * não de operação.
 */
@Injectable()
export class SomenteLeituraGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!ESCRITA.has(req.method)) return true;

    const user = req.user;
    if (!user || user.kind === "IDENTIDADE") return true;
    if (!user.contaSomenteLeitura) return true;

    const liberado = this.reflector.getAllAndOverride<boolean>(PERMITE_SOMENTE_LEITURA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (liberado) return true;

    throw new ForbiddenException({
      code: CODIGO_CONTA_SOMENTE_LEITURA,
      message:
        "Esta empresa está em modo somente leitura. Você continua vendo e exportando tudo, mas não dá pra lançar nada novo.",
    });
  }
}
