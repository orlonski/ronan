import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ConfirmarTrocaPixInput, SolicitarTrocaPixInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthMotorista } from "../auth/types";
import { RequerCapacidade } from "../common/acesso-app/capacidade.decorator";
import { PixMotoristaService } from "./pix.service";

/** "Onde recebo": o parceiro troca a chave Pix, confirmando com código no WhatsApp. */
@ApiTags("motorista/pix")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/pix")
@RequerCapacidade("app.pix.editar")
export class PixMotoristaController {
  constructor(private readonly service: PixMotoristaService) {}

  @Get()
  atual(@CurrentUser() user: AuthMotorista) {
    return this.service.atual(user.id);
  }

  @Post("solicitar")
  solicitar(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(SolicitarTrocaPixInput)) body: SolicitarTrocaPixInput,
  ) {
    return this.service.solicitar(user.id, body.chavePix);
  }

  @Post("confirmar")
  confirmar(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(ConfirmarTrocaPixInput)) body: ConfirmarTrocaPixInput,
  ) {
    return this.service.confirmar(user.id, body.codigo);
  }
}
