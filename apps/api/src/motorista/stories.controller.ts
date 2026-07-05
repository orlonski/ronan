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
import { CriarStoryBaseInput, ReagirStoryInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AcessoMotorista } from "../auth/decorators/acesso-motorista.decorator";
import { AcessoMotoristaGuard } from "../auth/guards/acesso-motorista.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { StoriesMotoristaService } from "./stories.service";

const CriarStoryPayload = CriarStoryBaseInput.extend({
  fotoKey: z.string().min(1),
});

@ApiTags("motorista/stories")
@ApiBearerAuth()
@UseGuards(RolesGuard, AcessoMotoristaGuard)
@Roles("MOTORISTA")
@AcessoMotorista("podeVerStories")
@Controller("m/stories")
export class StoriesMotoristaController {
  constructor(private readonly service: StoriesMotoristaService) {}

  @Get("feed")
  feed(@CurrentUser() user: AuthMotorista) {
    return this.service.feed(user.id);
  }

  @Post()
  criar(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarStoryPayload))
    body: z.infer<typeof CriarStoryPayload>,
  ) {
    return this.service.criar(user.id, body);
  }

  @Get(":id/foto")
  async foto(@Param("id") id: string, @Res() res: Response) {
    const { buffer, contentType } = await this.service.fotoBuffer(id);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(buffer);
  }

  @Post(":id/visto")
  @HttpCode(204)
  marcarVisto(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.marcarVisto(user.id, id);
  }

  @Post(":id/reacao")
  @HttpCode(204)
  reagir(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ReagirStoryInput))
    body: z.infer<typeof ReagirStoryInput>,
  ) {
    return this.service.reagir(user.id, id, body);
  }

  @Delete(":id/reacao")
  @HttpCode(204)
  removerReacao(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.removerReacao(user.id, id);
  }

  @Get(":id/visualizacoes")
  visualizacoes(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.visualizacoes(user.id, id);
  }

  @Delete(":id")
  @HttpCode(204)
  deletar(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.deletar(user.id, id);
  }
}
