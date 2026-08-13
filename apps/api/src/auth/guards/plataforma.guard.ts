import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { AuthUser } from "../types";

/**
 * Só operador da PLATAFORMA passa (o dono do sistema, `User.plataforma`).
 *
 * Diferente do `PermissaoGuard`, este é fail-CLOSED e não é global: ele é
 * aplicado explicitamente com `@UseGuards(PlataformaGuard)` no que gerencia as
 * empresas. Gerenciar contas não é uma permissão que um administrador de
 * empresa possa ganhar por engano na matriz de papéis — é outro nível, e por
 * isso não passa pelo catálogo de permissões.
 */
@Injectable()
export class PlataformaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user || user.kind !== "ADMIN_USER" || !user.plataforma) {
      throw new ForbiddenException("Só a equipe da plataforma acessa a gestão de empresas.");
    }
    return true;
  }
}
