import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { TetoDaContaInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PermissoesService } from "./permissoes.service";
import { EscopoRegistryService } from "../../common/escopo/escopo-registry.service";

@ApiTags("admin/permissoes")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@RequerPermissao("permissoes.gerenciar")
@Controller("admin/permissoes")
export class PermissoesController {
  constructor(
    private readonly service: PermissoesService,
    private readonly escopoRegistry: EscopoRegistryService,
  ) {}

  /**
   * Catálogo de permissões (agrupado por módulo na UI da matriz de papéis).
   *
   * `escopavel` diz se a chave continua valendo pra um usuário RESTRITO a
   * transportadora — derivado dos endpoints que sabem filtrar por frota, não de
   * lista mantida à mão. A matriz usa pra avisar que marcar a chave não vai
   * liberar a tela pro gestor de frota.
   */
  @Get()
  async listar() {
    const catalogo = await this.service.listarCatalogo();
    const escopaveis = new Set(this.escopoRegistry.listar());
    return catalogo.map((c) => ({ ...c, escopavel: escopaveis.has(c.chave) }));
  }

  /**
   * O teto PADRÃO das empresas — o que vale pra quem não tem teto próprio.
   *
   * Atrás do `PlataformaGuard`: mexer aqui vale pra todos os clientes de uma
   * vez, então não é decisão de administrador de empresa. É esta tela que
   * substitui a antiga lista fixa de "recursos da plataforma" no código.
   */
  @UseGuards(PlataformaGuard)
  @Get("teto-padrao")
  lerTetoPadrao() {
    return this.service.lerTetoPadrao();
  }

  @UseGuards(PlataformaGuard)
  @Put("teto-padrao")
  definirTetoPadrao(@Body(new ZodValidationPipe(TetoDaContaInput)) body: TetoDaContaInput) {
    return this.service.definirTetoPadrao(body.permissoes);
  }
}
