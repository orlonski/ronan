import { Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { MetaLeadsService } from "./meta-leads.service";

/**
 * Diagnóstico e disparo manual da importação do formulário da Meta.
 *
 * `status` responde "o servidor enxerga os formulários da Página?" sem ninguém
 * precisar ler log nem ver token; `importar` roda a varredura agora, em vez de
 * esperar os 3 minutos do cron.
 */
@ApiTags("captacao")
@Roles("ADMIN_USER")
@Controller("admin/captacao/meta-leads")
export class MetaLeadsController {
  constructor(private readonly metaLeads: MetaLeadsService) {}

  @RequerPermissao("prospeccao.ver")
  @Get("status")
  status() {
    return this.metaLeads.status();
  }

  @RequerPermissao("prospeccao.editar")
  @Post("importar")
  importar() {
    return this.metaLeads.importarRecentes();
  }
}
