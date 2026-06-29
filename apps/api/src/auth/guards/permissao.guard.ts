import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSAO_KEY } from "../decorators/requer-permissao.decorator";
import type { AuthUser } from "../types";

/**
 * Checa as permissões granulares do papel do usuário (chaves do catálogo RBAC).
 * Handlers/classes sem @RequerPermissao passam direto (compatível). Basta ter
 * UMA das chaves exigidas. Usado em conjunto com o RolesGuard (defesa em camadas).
 */
@Injectable()
export class PermissaoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const exigidas = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSAO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!exigidas || exigidas.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException("Não autenticado");
    if (user.kind !== "ADMIN_USER") throw new ForbiddenException("Permissão insuficiente");

    if (!exigidas.some((c) => user.permissoes.includes(c))) {
      throw new ForbiddenException("Você não tem permissão para acessar isto.");
    }
    return true;
  }
}
