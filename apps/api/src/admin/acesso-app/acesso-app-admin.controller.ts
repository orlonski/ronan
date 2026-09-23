import { Body, Controller, Delete, Get, Param, Post, Put, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  ConfigPlataformaAcessoAppInput,
  CriarExcecaoAppInput,
  ExcecaoLoteAppInput,
  FixarPerfilAppInput,
  PadraoAcessoAppInput,
  PreviaCadastroAppInput,
  RevogarExcecaoAppInput,
  SalvarPerfilAppInput,
  SalvarRegrasAppInput,
  SalvarTabelaAppInput,
  SimularAcessoAppInput,
  TravasServidorAppInput,
} from "@ronan/shared-types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { AcessoAppService } from "../../common/acesso-app/acesso-app.service";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AcessoAppAdminService } from "./acesso-app-admin.service";

/**
 * "Acesso ao app": quem vê o quê no celular.
 *
 * As chaves são as do recurso `perfis-acesso` que já existe — sem chave nova,
 * de propósito: conta com teto customizado não recebe chave criada depois (o
 * defeito que o c9e2390 achou), e aqui não há poder novo, só a tela nova.
 *   ver      → ler tudo, simular
 *   criar    → perfil novo
 *   editar   → perfil, quem recebe, padrão, passar pras regras
 *   excluir  → desligar perfil
 *   aplicar  → exceção por pessoa
 */
@ApiTags("admin/acesso-app")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/acesso-app")
export class AcessoAppAdminController {
  constructor(
    private readonly service: AcessoAppAdminService,
    private readonly acesso: AcessoAppService,
  ) {}

  @Get()
  @RequerPermissao("perfis-acesso.ver")
  painel(@CurrentUser() user: AuthAdminUser) {
    return this.service.painel(!!user.plataforma);
  }

  @Post("simular")
  @RequerPermissao("perfis-acesso.ver")
  simular(@Body(new ZodValidationPipe(SimularAcessoAppInput)) body: SimularAcessoAppInput) {
    return this.acesso.simular(body);
  }

  /** "Vai entrar como…" no cadastro novo: quem cadastra vê antes de salvar. */
  @Post("previa-cadastro")
  @RequerPermissao("motoristas.criar")
  previaCadastro(@Body(new ZodValidationPipe(PreviaCadastroAppInput)) body: PreviaCadastroAppInput) {
    return this.acesso.previaCadastro(body);
  }

  @Get("motoristas/:id")
  @RequerPermissao("motoristas.ver")
  @EscopoPor("motorista")
  explicarMotorista(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.explicarMotorista(id, user.escopo);
  }

  @Get("funcionarios/:id")
  @RequerPermissao("funcionarios.ver")
  explicarFuncionario(@Param("id") id: string) {
    return this.service.explicarFuncionario(id);
  }

  @Post("perfis")
  @RequerPermissao("perfis-acesso.criar")
  criarPerfil(
    @Body(new ZodValidationPipe(SalvarPerfilAppInput)) body: SalvarPerfilAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarPerfil(body, user.id, user.escopo);
  }

  @Patch("perfis/:id")
  @RequerPermissao("perfis-acesso.editar")
  editarPerfil(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SalvarPerfilAppInput)) body: SalvarPerfilAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.editarPerfil(id, body, user.id, user.escopo);
  }

  @Delete("perfis/:id")
  @RequerPermissao("perfis-acesso.excluir")
  desligarPerfil(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.desligarPerfil(id, user.id, user.escopo);
  }

  @Post("perfis/:id/religar")
  @RequerPermissao("perfis-acesso.excluir")
  religarPerfil(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.religarPerfil(id, user.id, user.escopo);
  }

  /** O que muda se estas colunas da tabela forem salvas. */
  @Post("tabela/simular")
  @RequerPermissao("perfis-acesso.ver")
  simularTabela(@Body(new ZodValidationPipe(SalvarTabelaAppInput)) body: SalvarTabelaAppInput) {
    return this.service.simularTabela(body);
  }

  /** As colunas da tabela: o que cada modalidade vê no celular. */
  @Put("tabela")
  @RequerPermissao("perfis-acesso.editar")
  salvarTabela(
    @Body(new ZodValidationPipe(SalvarTabelaAppInput)) body: SalvarTabelaAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarTabela(body, user.id, user.escopo);
  }

  @Put("regras")
  @RequerPermissao("perfis-acesso.editar")
  salvarRegras(
    @Body(new ZodValidationPipe(SalvarRegrasAppInput)) body: SalvarRegrasAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarRegras(body, user.id, user.escopo);
  }

  @Put("padrao")
  @RequerPermissao("perfis-acesso.editar")
  salvarPadrao(
    @Body(new ZodValidationPipe(PadraoAcessoAppInput)) body: PadraoAcessoAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarPadrao(body, user.id, user.escopo);
  }

  @Post("passar-para-regras")
  @RequerPermissao("perfis-acesso.editar")
  passarParaRegras(@CurrentUser() user: AuthAdminUser) {
    return this.service.passarParaRegras(user.id, user.escopo);
  }

  @Get("excecoes")
  @RequerPermissao("perfis-acesso.ver")
  @EscopoPor("motorista")
  listarExcecoes(
    @Query("origem") origem: string | undefined,
    @Query("cpf") cpf: string | undefined,
    @Query("prazo") prazo: string | undefined,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.listarExcecoes({ origem, cpf, prazo }, user.escopo);
  }

  @Post("excecoes")
  @RequerPermissao("perfis-acesso.aplicar")
  @EscopoPor("motorista")
  criarExcecao(
    @Body(new ZodValidationPipe(CriarExcecaoAppInput)) body: CriarExcecaoAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarExcecao(body, user.id, user.escopo);
  }

  @Post("excecoes/lote")
  @RequerPermissao("perfis-acesso.aplicar")
  @EscopoPor("motorista")
  criarExcecaoEmLote(
    @Body(new ZodValidationPipe(ExcecaoLoteAppInput)) body: ExcecaoLoteAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarExcecaoEmLote(body, user.id, user.escopo);
  }

  @Post("fixar")
  @RequerPermissao("perfis-acesso.aplicar")
  @EscopoPor("motorista")
  fixarPerfil(
    @Body(new ZodValidationPipe(FixarPerfilAppInput)) body: FixarPerfilAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.fixarPerfil(body, user.id, user.escopo);
  }

  @Post("excecoes/:id/revogar")
  @RequerPermissao("perfis-acesso.aplicar")
  @EscopoPor("motorista")
  revogarExcecao(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RevogarExcecaoAppInput)) body: RevogarExcecaoAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.revogarExcecao(id, body, user.id, user.escopo);
  }

  /** Só a plataforma: quem o servidor teria barrado (sombra), por capacidade. */
  @Get("plataforma/sombra-servidor")
  @UseGuards(PlataformaGuard)
  sombraDoServidor() {
    return this.service.sombraDoServidor();
  }

  /** Só a plataforma: o que o servidor já barra no app desta empresa. */
  @Put("plataforma/travas-servidor")
  @UseGuards(PlataformaGuard)
  salvarTravasServidor(
    @Body(new ZodValidationPipe(TravasServidorAppInput)) body: TravasServidorAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarTravasServidor(body, user.id);
  }

  /** Só a plataforma: travas que cortam e rollouts, empresa por empresa. */
  @Put("plataforma")
  @UseGuards(PlataformaGuard)
  salvarConfigPlataforma(
    @Body(new ZodValidationPipe(ConfigPlataformaAcessoAppInput)) body: ConfigPlataformaAcessoAppInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarConfigPlataforma(body, user.id);
  }
}
