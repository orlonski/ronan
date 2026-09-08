import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY, type RoleName } from "../decorators/roles.decorator";
import type { AuthUser } from "../types";

/**
 * Que papel cada tipo de token carrega.
 *
 * Mapa explícito, e não `kind === "ADMIN_USER" ? ... : "MOTORISTA"`: com o
 * ternário, TODO token que não fosse de admin passava como motorista — inclusive
 * o de IDENTIDADE, que é justamente de quem ainda não está em empresa nenhuma e
 * não pode chegar em endpoint de lançamento. Sendo um `Record` sobre o `kind`,
 * tipo novo no union vira erro de compilação aqui em vez de virar permissão
 * silenciosa.
 */
const PAPEIS_POR_KIND: Record<AuthUser["kind"], readonly RoleName[]> = {
  ADMIN_USER: ["ADMIN_USER"],
  MOTORISTA: ["MOTORISTA"],
  IDENTIDADE: ["IDENTIDADE"],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException("Não autenticado");

    // Kind desconhecido (token antigo, payload adulterado) não ganha papel
    // nenhum — recusa em vez de cair num default.
    const userRoles = PAPEIS_POR_KIND[user.kind] ?? [];

    if (!required.some((r) => userRoles.includes(r))) {
      throw new ForbiddenException("Permissão insuficiente");
    }
    return true;
  }
}
