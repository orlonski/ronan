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
import { CriarAbastecimentoBaseInput, FotoAbastecimentoInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AcessoMotorista } from "../auth/decorators/acesso-motorista.decorator";
import { AcessoMotoristaGuard } from "../auth/guards/acesso-motorista.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { AbastecimentosMotoristaService } from "./abastecimentos.service";

const CriarAbastecimentoPayload = CriarAbastecimentoBaseInput.extend({
  // Legado: app sem o OTA manda uma foto avulsa, que sempre foi o cupom.
  // Mantido de propósito — enquanto a frota não atualiza, é o que chega.
  fotoKey: z.string().optional(),
  // App novo: lista tipada (cupom / odômetro / bomba).
  fotos: z.array(FotoAbastecimentoInput).max(3).optional(),
}).refine((d) => d.emComboio || d.valorTotal !== undefined, {
  message: "Valor obrigatório quando não é abastecimento em comboio.",
  path: ["valorTotal"],
});

const MesSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve estar no formato YYYY-MM");

const ListarQuery = z.object({
  mes: MesSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

@ApiTags("motorista/abastecimentos")
@ApiBearerAuth()
@UseGuards(RolesGuard, AcessoMotoristaGuard)
@Roles("MOTORISTA")
@Controller("m/abastecimentos")
export class AbastecimentosMotoristaController {
  constructor(private readonly service: AbastecimentosMotoristaService) {}

  @Get()
  list(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListarQuery)) query: z.infer<typeof ListarQuery>,
  ) {
    return this.service.list(user.id, query);
  }

  @Get("postos-recentes")
  postosRecentes(@CurrentUser() user: AuthMotorista) {
    return this.service.ultimosPostos(user.id, 5);
  }

  @Post()
  @AcessoMotorista("podeLancarAbastecimento")
  create(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarAbastecimentoPayload))
    body: z.infer<typeof CriarAbastecimentoPayload>,
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
