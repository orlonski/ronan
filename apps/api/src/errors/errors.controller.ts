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
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthAdminUser, AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ErrorsService } from "./errors.service";

const ReportInput = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(20_000).optional(),
  versao: z.string().max(100).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  extra: z.unknown().optional(),
});

const ListarQuery = z.object({
  origem: z.enum(["motorista-app", "dashboard", "api"]).optional(),
  hash: z.string().optional(),
  userId: z.string().optional(),
  desde: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@ApiTags("errors")
@ApiBearerAuth()
@Controller("errors")
export class ErrorsController {
  constructor(private readonly service: ErrorsService) {}

  /**
   * Endpoint do app móvel pra reportar erros JS. Auth de motorista
   * (pra atrelar erro ao user). Sem rate-limit explícito — confia
   * que cliente tem retry com backoff.
   */
  @UseGuards(RolesGuard)
  @Roles("MOTORISTA")
  @Post("motorista")
  @HttpCode(204)
  async reportarMotorista(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(ReportInput))
    body: z.infer<typeof ReportInput>,
  ): Promise<void> {
    await this.service.reportar({
      ...body,
      origem: "motorista-app",
      userId: user.id,
      userType: "MOTORISTA",
    });
  }

  /**
   * Endpoint do dashboard pra reportar erros JS do navegador.
   */
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
  @Post("dashboard")
  @HttpCode(204)
  async reportarDashboard(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(ReportInput))
    body: z.infer<typeof ReportInput>,
  ): Promise<void> {
    await this.service.reportar({
      ...body,
      origem: "dashboard",
      userId: user.id,
      userType: user.perfil,
    });
  }

  // ===== Admin: ler erros =====

  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
  @Get("agrupados")
  agrupados(
    @Query(new ZodValidationPipe(ListarQuery))
    query: z.infer<typeof ListarQuery>,
  ) {
    return this.service.agrupados(query);
  }

  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
  @Get()
  listar(
    @Query(new ZodValidationPipe(ListarQuery))
    query: z.infer<typeof ListarQuery>,
  ) {
    return this.service.listar(query);
  }

  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }
}
