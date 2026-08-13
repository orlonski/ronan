import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CadastroMotoristaInput,
  ConfirmarCadastroInput,
  EsqueciSenhaInput,
  LoginInput,
  LoginMotoristaInput,
  RedefinirSenhaInput,
  RefreshInput,
  ReenviarCodigoInput,
  ReenviarSenhaInput,
  TrocarEmpresaInput,
  TrocarSenhaInput,
} from "@ronan/shared-types";
import { AuthService } from "./auth.service";
import { CadastroMotoristaService } from "./cadastro-motorista.service";
import { RedefinicaoSenhaService } from "./redefinicao-senha.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "./decorators/public.decorator";
import { Roles } from "./decorators/roles.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import { RolesGuard } from "./guards/roles.guard";
import type { AuthMotorista } from "./types";

@ApiTags("auth")
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cadastro: CadastroMotoristaService,
    private readonly redefinicaoSenha: RedefinicaoSenhaService,
  ) {}

  @Public()
  @HttpCode(200)
  @Post("m/auth/cadastro/iniciar")
  async iniciarCadastro(
    @Body(new ZodValidationPipe(CadastroMotoristaInput)) body: CadastroMotoristaInput,
  ) {
    return this.cadastro.iniciar(body);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/cadastro/reenviar")
  async reenviarCodigo(
    @Body(new ZodValidationPipe(ReenviarCodigoInput)) body: ReenviarCodigoInput,
  ) {
    return this.cadastro.reenviar(body.cpf, body.codigoEmpresa);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/cadastro/confirmar")
  async confirmarCadastro(
    @Body(new ZodValidationPipe(ConfirmarCadastroInput)) body: ConfirmarCadastroInput,
  ) {
    return this.cadastro.confirmar(body.cpf, body.codigo, body.codigoEmpresa);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/senha/esqueci")
  async esqueciSenha(@Body(new ZodValidationPipe(EsqueciSenhaInput)) body: EsqueciSenhaInput) {
    return this.redefinicaoSenha.esqueci(body.cpf, body.telefone);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/senha/reenviar")
  async reenviarSenha(@Body(new ZodValidationPipe(ReenviarSenhaInput)) body: ReenviarSenhaInput) {
    return this.redefinicaoSenha.reenviar(body.cpf);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/senha/redefinir")
  async redefinirSenha(@Body(new ZodValidationPipe(RedefinirSenhaInput)) body: RedefinirSenhaInput) {
    return this.redefinicaoSenha.redefinir(body.cpf, body.codigo, body.novaSenha);
  }

  @Public()
  @HttpCode(200)
  @Post("admin/auth/login")
  async loginAdmin(@Body(new ZodValidationPipe(LoginInput)) body: LoginInput) {
    return this.auth.loginAdmin(body.email, body.senha);
  }

  @Public()
  @HttpCode(200)
  @Post("admin/auth/refresh")
  async refreshAdmin(@Body(new ZodValidationPipe(RefreshInput)) body: RefreshInput) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/login")
  async loginMotorista(
    @Body(new ZodValidationPipe(LoginMotoristaInput)) body: LoginMotoristaInput,
  ) {
    return this.auth.loginMotorista(body.cpf, body.senha);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/refresh")
  async refreshMotorista(@Body(new ZodValidationPipe(RefreshInput)) body: RefreshInput) {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * As empresas em que este CPF tem cadastro — alimenta o seletor de empresa do
   * app. Não devolve nada da outra empresa além do nome dela.
   */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("MOTORISTA")
  @Get("m/auth/cadastros")
  async cadastros(@CurrentUser() user: AuthMotorista) {
    return this.auth.cadastrosDoMotorista(user.id);
  }

  /** Troca a empresa ativa sem pedir senha (só entre cadastros do mesmo CPF). */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("MOTORISTA")
  @HttpCode(200)
  @Post("m/auth/trocar-empresa")
  async trocarEmpresa(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(TrocarEmpresaInput)) body: TrocarEmpresaInput,
  ) {
    return this.auth.trocarEmpresa(user.id, body.motoristaId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("MOTORISTA")
  @Post("m/auth/trocar-senha")
  async trocarSenha(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(TrocarSenhaInput)) body: TrocarSenhaInput,
  ) {
    await this.auth.trocarSenhaMotorista(user.id, body.senhaAtual, body.novaSenha);
    return { ok: true };
  }
}
