import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
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
}
