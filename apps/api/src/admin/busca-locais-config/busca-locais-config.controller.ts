import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { BuscaLocaisConfigService } from "./busca-locais-config.service";

const AtualizarSchema = z
  .object({
    raioInicialM: z.number().int().min(20).max(2000).optional(),
    raioAmpliadoM: z.number().int().min(20).max(2000).optional(),
  })
  .refine(
    (v) =>
      v.raioInicialM == null ||
      v.raioAmpliadoM == null ||
      v.raioAmpliadoM >= v.raioInicialM,
    { message: "raioAmpliadoM deve ser >= raioInicialM", path: ["raioAmpliadoM"] },
  );

@ApiTags("admin/busca-locais-config")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/busca-locais-config")
export class BuscaLocaisConfigController {
  constructor(private readonly service: BuscaLocaisConfigService) {}

  @Roles("ADMIN", "OPERADOR")
  @Get()
  get() {
    return this.service.get();
  }

  @Roles("ADMIN")
  @Put()
  update(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(AtualizarSchema)) body: z.infer<typeof AtualizarSchema>,
  ) {
    return this.service.update(body, user.id);
  }
}
