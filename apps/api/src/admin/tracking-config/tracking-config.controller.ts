import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { TrackingConfigService } from "./tracking-config.service";

const AtualizarConfigSchema = z.object({
  distanciaMinMetros: z.number().int().min(5).max(500).optional(),
  intervaloMaxSegundos: z.number().int().min(10).max(300).optional(),
  precisaoAlta: z.boolean().optional(),
  accuracyMaxMetros: z.number().int().min(20).max(500).optional(),
  velocidadeMaxKmh: z.number().int().min(50).max(400).optional(),
  autoFinalizarHoras: z.number().int().min(1).max(24).optional(),
  detectorAtivado: z.boolean().optional(),
  detectorVelocidadeKmh: z.number().int().min(10).max(120).optional(),
  detectorLeituras: z.number().int().min(1).max(10).optional(),
});

@ApiTags("admin/tracking-config")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/tracking-config")
export class TrackingConfigController {
  constructor(private readonly service: TrackingConfigService) {}

  @Roles("ADMIN", "OPERADOR")
  @Get()
  get() {
    return this.service.get();
  }

  @Roles("ADMIN")
  @RequerPermissao("config-tracking.editar")
  @Put()
  update(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(AtualizarConfigSchema))
    body: z.infer<typeof AtualizarConfigSchema>,
  ) {
    return this.service.update(body, user.id);
  }
}
