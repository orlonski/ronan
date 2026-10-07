import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { TentativasDeLogin } from "../common/rate-limit/tentativas-de-login";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CadastroMotoristaInput,
  ConfirmarCadastroInput,
  DefinirContaAtivaInput,
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
import { ContaAtivaService } from "./conta-ativa.service";
import { CadastroMotoristaService } from "./cadastro-motorista.service";
import { RedefinicaoSenhaService } from "./redefinicao-senha.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { Public } from "./decorators/public.decorator";
import { Roles } from "./decorators/roles.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import { RolesGuard } from "./guards/roles.guard";
import { PlataformaGuard } from "./guards/plataforma.guard";
import type { AuthAdminUser, AuthIdentidade, AuthMotorista } from "./types";

// Cada chamada que passa manda um WhatsApp: sem freio por IP, isto vira disparador.
const limiteCadastro = criarRateLimitIpGuard({ limitePorMinuto: 10, nome: "cadastro-motorista" });

// Login do painel: sem freio, dava pra testar senha de administrador à vontade.
// Por IP (muitos e-mails com uma senha comum) e por e-mail (uma conta, muitas senhas).
const limiteLoginAdminIp = criarRateLimitIpGuard({ limitePorMinuto: 30, nome: "login-admin" });
// App do motorista: o bloqueio por CPF já existe (auth.service); este é o freio
// contra testar uma senha comum em muitos CPFs. 60, e não 30: no 4G muitos
// celulares saem pelo MESMO IP da operadora (CGNAT).
const limiteLoginMotoristaIp = criarRateLimitIpGuard({
  limitePorMinuto: 60,
  nome: "login-motorista",
  mensagem: "Muitas tentativas seguidas deste aparelho. Espere um minuto e tente de novo.",
});
const tentativasAdmin = new TentativasDeLogin({ maxFalhas: 10, janelaMs: 15 * 60_000, bloqueioMs: 15 * 60_000 });

@ApiTags("auth")
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cadastro: CadastroMotoristaService,
    private readonly redefinicaoSenha: RedefinicaoSenhaService,
    private readonly contaAtiva: ContaAtivaService,
  ) {}

  @Public()
  @UseGuards(limiteCadastro)
  @HttpCode(200)
  @Post("m/auth/cadastro/iniciar")
  async iniciarCadastro(
    @Body(new ZodValidationPipe(CadastroMotoristaInput)) body: CadastroMotoristaInput,
  ) {
    return this.cadastro.iniciar(body);
  }

  @Public()
  @UseGuards(limiteCadastro)
  @HttpCode(200)
  @Post("m/auth/cadastro/reenviar")
  async reenviarCodigo(
    @Body(new ZodValidationPipe(ReenviarCodigoInput)) body: ReenviarCodigoInput,
  ) {
    return this.cadastro.reenviar(body.cpf);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/cadastro/confirmar")
  async confirmarCadastro(
    @Body(new ZodValidationPipe(ConfirmarCadastroInput)) body: ConfirmarCadastroInput,
  ) {
    return this.cadastro.confirmar(body.cpf, body.codigo);
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
  @UseGuards(limiteLoginAdminIp)
  async loginAdmin(@Body(new ZodValidationPipe(LoginInput)) body: LoginInput) {
    const chave = body.email.trim().toLowerCase();
    const faltam = tentativasAdmin.bloqueada(chave);
    if (faltam != null) {
      throw new HttpException(
        `Muitas tentativas com este e-mail. Tente de novo em ${faltam} minuto${faltam === 1 ? "" : "s"}, ou use "Esqueci a senha".`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      const r = await this.auth.loginAdmin(body.email, body.senha);
      tentativasAdmin.acertou(chave);
      return r;
    } catch (e) {
      // Só senha/usuário errados contam; queda do banco não bloqueia ninguém.
      if (e instanceof UnauthorizedException) tentativasAdmin.falhou(chave);
      throw e;
    }
  }

  @Public()
  @HttpCode(200)
  @Post("admin/auth/refresh")
  async refreshAdmin(@Body(new ZodValidationPipe(RefreshInput)) body: RefreshInput) {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * Entra numa empresa pra dar suporte, ou volta pra casa com `contaId: null`.
   *
   * Não emite token novo: a conta ativa mora no banco e o `JwtStrategy` a relê a
   * cada requisição, então o token que o painel já tem passa a valer pra empresa
   * nova sozinho. O painel precisa limpar o cache dele depois de chamar aqui.
   */
  @ApiBearerAuth()
  @Roles("ADMIN_USER")
  @UseGuards(RolesGuard, PlataformaGuard)
  @HttpCode(200)
  @Post("admin/auth/conta-ativa")
  async definirContaAtiva(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(DefinirContaAtivaInput)) body: DefinirContaAtivaInput,
  ) {
    return this.contaAtiva.definir(user, body.contaId);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/login")
  @UseGuards(limiteLoginMotoristaIp)
  async loginMotorista(
    @Body(new ZodValidationPipe(LoginMotoristaInput)) body: LoginMotoristaInput,
  ) {
    return this.auth.loginMotorista(body.cpf, body.senha, body.suportaIdentidade ?? false);
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

  /**
   * A sessão da PESSOA pra quem já está logado numa empresa.
   *
   * O app chama quando tem sessão de empresa mas não tem a da pessoa — o caso de
   * quem já estava logado antes desta versão. Ver `identidadeDoMotorista`.
   */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("MOTORISTA")
  @HttpCode(200)
  @Post("m/auth/identidade")
  async identidade(@CurrentUser() user: AuthMotorista) {
    return this.auth.identidadeDoMotorista(user.id);
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

  /**
   * Troca de senha pela PESSOA — quem não está em empresa nenhuma não tem token
   * de MOTORISTA, e sem isto ficaria sem como trocar a própria senha.
   * A senha sempre foi da pessoa; só faltava a porta.
   */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("IDENTIDADE")
  @Post("m/eu/trocar-senha")
  async trocarSenhaPessoa(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(TrocarSenhaInput)) body: TrocarSenhaInput,
  ) {
    await this.auth.trocarSenhaIdentidade(user.id, body.senhaAtual, body.novaSenha);
    return { ok: true };
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
