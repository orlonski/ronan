import { Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
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
const LeadTesteInput = z.object({
  nome: z.string().min(2),
  telefone: z.string().min(10),
  funcao: z.string().min(2),
  frota: z.string().min(1),
});

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

  /** Lead de teste no formulário (a ferramenta da Meta não abre pra automação). */
  @RequerPermissao("prospeccao.editar")
  @Post("lead-teste")
  leadTeste(@Body(new ZodValidationPipe(LeadTesteInput)) body: z.infer<typeof LeadTesteInput>) {
    return this.metaLeads.criarLeadDeTeste(body);
  }

  @RequerPermissao("prospeccao.editar")
  @Post("importar")
  importar() {
    return this.metaLeads.importarRecentes();
  }
}
