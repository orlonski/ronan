import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PermissoesService } from "./permissoes.service";

@ApiTags("admin/permissoes")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN")
@Controller("admin/permissoes")
export class PermissoesController {
  constructor(private readonly service: PermissoesService) {}

  /** Catálogo de permissões (agrupado por módulo na UI da matriz de papéis). */
  @Get()
  listar() {
    return this.service.listarCatalogo();
  }
}
