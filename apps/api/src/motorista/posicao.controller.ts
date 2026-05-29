import { Body, Controller, Get, HttpCode, Put, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  EnviarPosicoesInput,
  PosicaoMotoristaConfig as PosicaoConfigSchema,
} from "@ronan/shared-types";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PosicaoMotoristaService } from "./posicao.service";

@ApiTags("motorista/posicao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller()
export class PosicaoMotoristaController {
  constructor(private readonly service: PosicaoMotoristaService) {}

  @Get("m/posicao-config")
  getConfig(@CurrentUser() user: AuthMotorista) {
    return this.service.getConfig(user.id);
  }

  @Put("m/posicao-config")
  salvarConfig(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(PosicaoConfigSchema))
    body: z.infer<typeof PosicaoConfigSchema>,
  ) {
    return this.service.salvarConfig(user.id, body);
  }

  @Post("m/posicoes")
  @HttpCode(204)
  async receber(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(EnviarPosicoesInput))
    body: z.infer<typeof EnviarPosicoesInput>,
  ): Promise<void> {
    await this.service.receberPosicoes(user.id, body);
  }
}
