import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PublicarTermoInput } from "@ronan/shared-types";
import { Roles } from "../auth/decorators/roles.decorator";
import { PlataformaGuard } from "../auth/guards/plataforma.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TermosService } from "./termos.service";

/**
 * Publicar versão nova dos termos. Atrás do `PlataformaGuard`, pelo mesmo
 * motivo da tabela de preço: isto é o contrato da Movatruck, não configuração
 * de empresa nenhuma. Um administrador de transportadora não pode nem ver.
 *
 * O boot-check aceita o `PlataformaGuard` como fechamento suficiente — ele
 * fecha MAIS do que a matriz de permissões fecharia.
 */
@ApiTags("termos")
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@Controller("admin/termos")
export class TermosAdminController {
  constructor(private readonly service: TermosService) {}

  @Get()
  listarTudo() {
    return this.service.listarPublicados();
  }

  @Post()
  publicar(@Body(new ZodValidationPipe(PublicarTermoInput)) body: PublicarTermoInput) {
    return this.service.publicar(body);
  }
}
