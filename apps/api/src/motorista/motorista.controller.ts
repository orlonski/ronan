import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RegistrarPushTokenInput } from "@ronan/shared-types";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MotoristaService } from "./motorista.service";

@ApiTags("motorista")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m")
export class MotoristaController {
  constructor(private readonly service: MotoristaService) {}

  @Get("me")
  me(@CurrentUser() user: AuthMotorista) {
    return this.service.me(user.id);
  }

  @Get("catalogos")
  catalogos(@CurrentUser() user: AuthMotorista) {
    return this.service.catalogos(user.id);
  }

  @Get("catalogos/buscar")
  buscarCatalogo(
    @CurrentUser() user: AuthMotorista,
    @Query("tipo") tipo: string,
    @Query("q") q: string,
    @Query("ancora_local_id") ancoraLocalId?: string,
  ) {
    if (!["material", "cliente", "local", "veiculo"].includes(tipo)) {
      throw new BadRequestException("tipo inválido");
    }
    return this.service.buscarCatalogo(
      user.id,
      tipo as "material" | "cliente" | "local" | "veiculo",
      q ?? "",
      ancoraLocalId,
    );
  }

  @Get("catalogos/locais-recentes")
  locaisRecentes(
    @CurrentUser() user: AuthMotorista,
    @Query("tipo") tipoUso?: string,
    @Query("dias") dias?: string,
  ) {
    const t = tipoUso === "carga" || tipoUso === "descarga" ? tipoUso : "ambos";
    const d = dias ? Math.max(1, Math.min(180, Number(dias))) : 30;
    return this.service.locaisRecentes(user.id, t, d);
  }

  @Post("push-token")
  async registrarPushToken(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(RegistrarPushTokenInput)) body: RegistrarPushTokenInput,
  ) {
    await this.service.registrarPushToken(user.id, body.token);
    return { ok: true };
  }
}
