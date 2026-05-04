import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CriarViagemInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ViagensMotoristaService } from "./viagens.service";

const CriarViagemPayload = CriarViagemInput.extend({
  fotoKey: z.string().optional(),
});

@ApiTags("motorista/viagens")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/viagens")
export class ViagensMotoristaController {
  constructor(private readonly service: ViagensMotoristaService) {}

  @Get()
  list(@CurrentUser() user: AuthMotorista) {
    return this.service.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarViagemPayload)) body: z.infer<typeof CriarViagemPayload>,
  ) {
    return this.service.create(user.id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.delete(user.id, id);
  }
}
