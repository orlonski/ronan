import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { AgenteConfigService } from "./agente-config.service";

const AtualizarAgenteConfigSchema = z.object({
  provider: z.enum(["anthropic", "gemini"]).optional(),
  modeloAnthropic: z.string().min(1).max(100).optional(),
  modeloGemini: z.string().min(1).max(100).optional(),
  ativo: z.boolean().optional(),
  mensagemInativo: z.string().max(500).nullable().optional(),
});

@ApiTags("admin/agente-config")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/agente-config")
export class AgenteConfigController {
  constructor(private readonly service: AgenteConfigService) {}

  @Roles("ADMIN_USER")
  @Get()
  get() {
    return this.service.get();
  }

  @Roles("ADMIN_USER")
  @RequerPermissao("config-agente.editar")
  @Put()
  update(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(AtualizarAgenteConfigSchema))
    body: z.infer<typeof AtualizarAgenteConfigSchema>,
  ) {
    return this.service.update(body, user.id);
  }
}
