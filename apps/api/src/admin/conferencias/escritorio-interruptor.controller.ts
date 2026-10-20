import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../../auth/decorators/roles.decorator";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { EscritorioSnapshotService } from "../../conferencia-ticket/escritorio-snapshot";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";

/**
 * Interruptor do Escritório de Agentes, só da plataforma. Sem tela de propósito:
 * é freio de emergência (a 1ª versão da tela travou o banco da produção), não
 * configuração do dia a dia. Nasce desligado; desligar vale em segundos.
 */
@ApiTags("admin/plataforma")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@Controller("admin/plataforma/escritorio")
export class EscritorioInterruptorController {
  constructor(private readonly escritorio: EscritorioSnapshotService) {}

  @Get()
  async estado() {
    return { ativo: await this.escritorio.ativo() };
  }

  @Post()
  async definir(@Body(new ZodValidationPipe(z.object({ ativo: z.boolean() }).strict())) body: { ativo: boolean }) {
    return { ativo: await this.escritorio.definirAtivo(body.ativo) };
  }
}
