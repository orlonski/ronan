import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { map, type Observable } from "rxjs";
import { z } from "zod";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AdminInboxService } from "./inbox.service";

const ListarQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(),
  naoLidas: z.enum(["true", "false"]).optional(),
});

@ApiTags("admin/inbox")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/inbox")
export class AdminInboxController {
  constructor(private readonly service: AdminInboxService) {}

  @Get()
  listar(
    @CurrentUser() user: AuthAdminUser,
    @Query(new ZodValidationPipe(ListarQuery)) q: z.infer<typeof ListarQuery>,
  ) {
    return this.service.listar(user.id, {
      limit: q.limit,
      cursor: q.cursor,
      somenteNaoLidas: q.naoLidas === "true",
    });
  }

  @Get("contar")
  async contar(@CurrentUser() user: AuthAdminUser) {
    const naoLidas = await this.service.contarNaoLidas(user.id);
    return { naoLidas };
  }

  @Patch(":id/lida")
  marcarLida(
    @CurrentUser() user: AuthAdminUser,
    @Param("id") id: string,
  ) {
    return this.service.marcarLida(id, user.id);
  }

  @Post("marcar-todas-lidas")
  @HttpCode(200)
  marcarTodasLidas(@CurrentUser() user: AuthAdminUser) {
    return this.service.marcarTodasLidas(user.id);
  }

  /**
   * Stream SSE: backend empurra notificações novas pro browser sem polling.
   * EventSource nativo não aceita Authorization header — o cliente passa o
   * JWT via ?access_token=... (a JwtStrategy aceita esse parâmetro).
   *
   * Conexão fica aberta até o cliente desconectar (aba fechada / navegação).
   * Reconnect automático pelo browser quando cair.
   */
  @Sse("stream")
  stream(
    @CurrentUser() user: AuthAdminUser,
  ): Observable<{ data: string }> {
    return this.service.stream(user.id).pipe(
      map((notif) => ({
        // SSE manda string. Stringify pro JSON conhecido.
        data: JSON.stringify(notif),
      })),
    );
  }
}
