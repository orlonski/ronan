import { Controller, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { ResumoService } from "./resumo.service";

@ApiTags("admin/resumo")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/resumo")
export class ResumoController {
  constructor(private readonly service: ResumoService) {}

  /** Envia o resumo atualizado agora pro WhatsApp do usuário informado. */
  @Roles("ADMIN_USER")
  @RequerPermissao("usuarios.editar")
  @Post("enviar/:userId")
  enviar(@Param("userId") userId: string) {
    return this.service.enviarAgora(userId);
  }
}
