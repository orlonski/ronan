import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
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
import { AcessoMotorista } from "../auth/decorators/acesso-motorista.decorator";
import { AcessoMotoristaGuard } from "../auth/guards/acesso-motorista.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ViagensMotoristaService } from "./viagens.service";

const CriarViagemPayload = CriarViagemInput.extend({
  fotoKey: z.string().optional(),
});

const AdicionarFotoInput = z.object({
  fotoKey: z.string().min(1),
});

const MesSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve estar no formato YYYY-MM");

const ListarViagensQuery = z.object({
  mes: MesSchema.optional(),
  status: z.enum(["AGUARDANDO", "CONFERIDA", "DIVERGENTE"]).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const ResumoMesQuery = z.object({
  mes: MesSchema.optional(),
});

function mesAtual(): string {
  const now = new Date();
  const ano = now.getUTCFullYear();
  const mes = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

@ApiTags("motorista/viagens")
@ApiBearerAuth()
@UseGuards(RolesGuard, AcessoMotoristaGuard)
@Roles("MOTORISTA")
@Controller("m/viagens")
export class ViagensMotoristaController {
  constructor(private readonly service: ViagensMotoristaService) {}

  @Get()
  list(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListarViagensQuery))
    query: z.infer<typeof ListarViagensQuery>,
  ) {
    return this.service.list(user.id, {
      mes: query.mes,
      grupoStatus: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get("resumo")
  resumo(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ResumoMesQuery))
    query: z.infer<typeof ResumoMesQuery>,
  ) {
    return this.service.resumoMes(user.id, query.mes ?? mesAtual());
  }

  @Post()
  @AcessoMotorista("podeLancarViagem")
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

  /**
   * Anexa foto a uma viagem já criada. Motorista subiu a foto antes via
   * POST /m/uploads/ticket (obtém fotoKey) e chama aqui. Padrão 2-step,
   * compatível com o outbox offline.
   */
  @Post(":id/fotos")
  adicionarFoto(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdicionarFotoInput))
    body: z.infer<typeof AdicionarFotoInput>,
  ) {
    return this.service.adicionarFoto(user.id, id, body.fotoKey);
  }
}
