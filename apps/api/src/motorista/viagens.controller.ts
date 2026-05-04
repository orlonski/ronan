import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
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

  @Get(":id")
  detalhe(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.detalhe(user.id, id);
  }

  @Get(":id/fotos/:fotoId")
  async foto(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.fotoBuffer(
      user.id,
      id,
      fotoId,
    );
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }
}
