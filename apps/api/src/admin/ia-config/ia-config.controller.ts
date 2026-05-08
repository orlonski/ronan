import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { IaConfigService } from "./ia-config.service";

const AtualizarIaConfigSchema = z.object({
  confidenceMinimo: z.number().min(0.5).max(0.99).optional(),
  janelaDias: z.number().int().min(1).max(14).optional(),
});

@ApiTags("admin/ia-config")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/ia-config")
export class IaConfigController {
  constructor(private readonly service: IaConfigService) {}

  @Roles("ADMIN", "OPERADOR")
  @Get()
  get() {
    return this.service.get();
  }

  @Roles("ADMIN", "OPERADOR")
  @Get("historico-sugestoes")
  historico() {
    return this.service.historicoSugestoes();
  }

  @Roles("ADMIN")
  @Put()
  update(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(AtualizarIaConfigSchema))
    body: z.infer<typeof AtualizarIaConfigSchema>,
  ) {
    return this.service.update(body, user.id);
  }
}
