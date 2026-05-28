import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { EventoMotoristaBatch } from "@ronan/shared-types";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { EventosService } from "./eventos.service";

const ListarQuery = z.object({
  motoristaId: z.string().optional(),
  viagemId: z.string().optional(),
  /** CSV de tipos. Parseado no controller. */
  tipo: z.string().optional(),
  desde: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  /** "true" | "false" — parseado no controller. */
  online: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});

const ReceberQuery = z.object({
  origem: z.enum(["motorista-app", "motorista-pwa"]),
});

@ApiTags("eventos")
@ApiBearerAuth()
@Controller()
export class EventosController {
  constructor(private readonly service: EventosService) {}

  /**
   * Batch de eventos do motorista. Idempotente por id (cliente gera UUID).
   * Origem (app nativo vs PWA) vem como query param pra controller não
   * precisar inspecionar user-agent.
   */
  @UseGuards(RolesGuard)
  @Roles("MOTORISTA")
  @Post("m/eventos")
  @HttpCode(204)
  async receber(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ReceberQuery)) q: z.infer<typeof ReceberQuery>,
    @Body(new ZodValidationPipe(EventoMotoristaBatch))
    body: z.infer<typeof EventoMotoristaBatch>,
  ): Promise<void> {
    await this.service.receberBatch(user.id, q.origem, body.eventos);
  }

  // ===== Admin: leitura =====

  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
  @Get("admin/eventos")
  listar(
    @Query(new ZodValidationPipe(ListarQuery))
    query: z.infer<typeof ListarQuery>,
  ) {
    const tipos = query.tipo?.split(",").filter(Boolean);
    return this.service.listar({
      motoristaId: query.motoristaId,
      viagemId: query.viagemId,
      tipo: tipos && tipos.length === 1 ? tipos[0] : tipos,
      desde: query.desde,
      ate: query.ate,
      online: query.online === "true" ? true : query.online === "false" ? false : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /**
   * Atalho pra timeline de uma viagem específica (combina viagemId já
   * reconciliado E viagemClientId pendente).
   */
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
  @Get("admin/eventos/viagem/:viagemId")
  porViagem(@Param("viagemId") viagemId: string) {
    return this.service.listarPorViagem(viagemId);
  }
}
