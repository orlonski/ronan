import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  SalvarAvisoInput,
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
import { AvisosAdminService, RegistroAlteracoesService } from "./avisos-admin.service";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { z } from "zod";

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
  constructor(
    private readonly service: IntegracoesService,
    private readonly avisos: AvisosAdminService,
  ) {}

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

  // ------------------------------------------------- avisos automáticos --

  @Get(":id/avisos")
  @RequerPermissao("integracoes.ver")
  obterAvisos(@Param("id", ParseUUIDPipe) id: string) {
    return this.avisos.obter(id);
  }

  @Put(":id/avisos")
  @RequerPermissao("integracoes.gerenciar")
  @Header("Cache-Control", "no-store")
  salvarAvisos(
    @CurrentUser() user: AuthAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SalvarAvisoInput)) body: SalvarAvisoInput,
  ) {
    return this.avisos.salvar(user, id, body);
  }

  @Post(":id/avisos/teste")
  @RequerPermissao("integracoes.gerenciar")
  testarAvisos(@Param("id", ParseUUIDPipe) id: string) {
    return this.avisos.testar(id);
  }

  @Post(":id/avisos/desligar")
  @HttpCode(204)
  @RequerPermissao("integracoes.gerenciar")
  async desligarAvisos(
    @CurrentUser() user: AuthAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RevogarIntegracaoInput)) body: RevogarIntegracaoInput,
  ) {
    await this.avisos.desligar(user, id, body.motivo);
  }

  @Post(":id/avisos/religar")
  @HttpCode(204)
  @RequerPermissao("integracoes.gerenciar")
  async religarAvisos(@CurrentUser() user: AuthAdminUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.avisos.religar(user, id);
  }

  @Post(":id/avisos/entregas/:entregaId/reentregar")
  @HttpCode(204)
  @RequerPermissao("integracoes.gerenciar")
  async reentregar(@Param("id", ParseUUIDPipe) id: string, @Param("entregaId", ParseUUIDPipe) entregaId: string) {
    await this.avisos.reentregar(id, entregaId);
  }
}

/**
 * Interruptor do registro de mudanças (gatilho no banco), só da plataforma.
 * Sem tela de propósito: é freio de emergência, não configuração do dia a dia.
 */
@ApiTags("admin/plataforma")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@Controller("admin/plataforma/registro-alteracoes")
export class RegistroAlteracoesController {
  constructor(private readonly registro: RegistroAlteracoesService) {}

  @Get()
  estado() {
    return this.registro.estado();
  }

  @Post()
  definir(@Body(new ZodValidationPipe(z.object({ ligado: z.boolean() }).strict())) body: { ligado: boolean }) {
    return this.registro.definir(body.ligado);
  }
}
