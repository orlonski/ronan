import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ESCOPO_KEY,
  IGNORA_ESCOPO_KEY,
} from "../../common/escopo/escopo.decorator";
import type { AuthUser } from "../types";

/**
 * Trava fail-closed do acesso restrito por transportadora.
 *
 * Usuário com `acessoGlobal` (todo mundo da Schaba) passa direto — este guard
 * não muda nada do comportamento de hoje. Usuário RESTRITO só alcança handler
 * que declarou `@EscopoPor` ou `@IgnoraEscopo`; qualquer outro devolve 403.
 *
 * O ponto é a direção do default: endpoint novo nasce FECHADO pro restrito, em
 * vez de vazar até alguém lembrar de filtrar. É o oposto do `PermissaoGuard`,
 * que é fail-open de propósito por compatibilidade.
 *
 * O decorator vale no controller inteiro (nível de classe) e o handler pode
 * sobrescrever — por isso `getAllAndOverride`.
 */
@Injectable()
export class EscopoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;

    // Rota pública (sem user) ou app do motorista: escopo não se aplica —
    // `/m/*` já é escopado no próprio motorista.
    if (!user || user.kind !== "ADMIN_USER") return true;

    // Acesso global: nada a restringir.
    if (!user.escopo) return true;

    const declarado =
      this.reflector.getAllAndOverride<string | undefined>(ESCOPO_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ??
      this.reflector.getAllAndOverride<boolean | undefined>(IGNORA_ESCOPO_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (!declarado) {
      throw new ForbiddenException(
        "Seu acesso é restrito à sua transportadora e esta área não está disponível.",
      );
    }
    return true;
  }
}
