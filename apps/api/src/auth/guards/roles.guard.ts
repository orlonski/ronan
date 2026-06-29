import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY, type RoleName } from "../decorators/roles.decorator";
import type { AuthUser } from "../types";

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

    const userRoles: RoleName[] =
      user.kind === "ADMIN_USER" ? ["ADMIN_USER"] : ["MOTORISTA"];

    if (!required.some((r) => userRoles.includes(r))) {
      throw new ForbiddenException("Permissão insuficiente");
    }
    return true;
  }
}
