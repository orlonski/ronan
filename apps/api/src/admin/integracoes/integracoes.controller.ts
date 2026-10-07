import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CriarIntegracaoInput,
  ESCOPOS_INTEGRACAO,
  RevogarIntegracaoInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { IntegracoesService } from "./integracoes.service";

/**
 * Tela "Conectar outro sistema". A chave completa só sai nas duas rotas que a
 * geram, e com `Cache-Control: no-store`: depois disso só existe o hash.
 */
@ApiTags("admin/integracoes")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/integracoes")
export class IntegracoesController {
  constructor(private readonly service: IntegracoesService) {}

  @Get()
  @RequerPermissao("integracoes.ver")
  async listar(@CurrentUser() user: AuthAdminUser) {
    const [integracoes, podeDar] = await Promise.all([this.service.listar(), this.service.escoposQuePodeDar(user)]);
    return {
      integracoes,
      escopos: ESCOPOS_INTEGRACAO.map((e) => ({ chave: e.chave, titulo: e.titulo, descricao: e.descricao, podeDar: podeDar.includes(e.chave) })),
      podeCriar: !user.assumida && user.escopo === null,
    };
  }

  @Post()
  @RequerPermissao("integracoes.gerenciar")
  @Header("Cache-Control", "no-store")
  criar(@CurrentUser() user: AuthAdminUser, @Body(new ZodValidationPipe(CriarIntegracaoInput)) body: CriarIntegracaoInput) {
    return this.service.criar(user, body);
  }

  @Post(":id/chaves")
  @RequerPermissao("integracoes.gerenciar")
  @Header("Cache-Control", "no-store")
  gerarChave(@CurrentUser() user: AuthAdminUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.gerarChave(user, id);
  }

  @Post(":id/chaves/:chaveId/revogar")
  @HttpCode(204)
  @RequerPermissao("integracoes.gerenciar")
  async revogarChave(
    @CurrentUser() user: AuthAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("chaveId", ParseUUIDPipe) chaveId: string,
    @Body(new ZodValidationPipe(RevogarIntegracaoInput)) body: RevogarIntegracaoInput,
  ) {
    await this.service.revogarChave(user, id, chaveId, body.motivo);
  }

  @Post(":id/revogar")
  @HttpCode(204)
  @RequerPermissao("integracoes.gerenciar")
  async revogar(
    @CurrentUser() user: AuthAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RevogarIntegracaoInput)) body: RevogarIntegracaoInput,
  ) {
    await this.service.revogar(user, id, body.motivo);
  }
}
