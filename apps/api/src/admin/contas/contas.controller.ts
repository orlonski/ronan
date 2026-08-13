import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { ContasService } from "./contas.service";

const CriarContaBody = z.object({
  nome: z.string().trim().min(2, "Diga o nome da empresa."),
  slug: z.string().trim().optional(),
  cnpj: z.string().trim().optional(),
  adminNome: z.string().trim().min(2, "Diga o nome de quem vai administrar."),
  adminEmail: z.string().trim().email("E-mail inválido."),
  adminSenha: z.string().min(8, "A senha precisa de pelo menos 8 caracteres."),
});

const AtivaBody = z.object({ ativa: z.boolean() });

/**
 * Gestão das empresas que usam o sistema. Fica atrás do `PlataformaGuard`, e não
 * do catálogo de permissões: criar empresa não é algo que um administrador de
 * empresa possa ganhar por engano na matriz de papéis.
 */
@ApiTags("admin/contas")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/contas")
export class ContasController {
  constructor(private readonly service: ContasService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  criar(@Body(new ZodValidationPipe(CriarContaBody)) body: z.infer<typeof CriarContaBody>) {
    return this.service.criar(body);
  }

  @Patch(":id/ativa")
  definirAtiva(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtivaBody)) body: z.infer<typeof AtivaBody>,
  ) {
    return this.service.definirAtiva(id, body.ativa);
  }

  @Patch(":id/auto-cadastro")
  definirAutoCadastro(@Param("id") id: string) {
    return this.service.definirAutoCadastro(id);
  }
}
