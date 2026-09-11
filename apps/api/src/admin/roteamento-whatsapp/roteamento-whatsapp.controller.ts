import { Body, Controller, Get, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AdicionarNumeroMetaInput,
  AtualizarRoteamentoPlataformaInput,
  AtualizarRoteamentoWhatsappInput,
  RegistrarNumeroMetaInput,
  SolicitarCodigoMetaInput,
  VerificarCodigoMetaInput,
} from "@ronan/shared-types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthUser } from "../../auth/types";
import { comConta } from "../../common/conta/conta-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { contaAlvo } from "../../whatsapp/conta-alvo";
import { AdminRoteamentoWhatsappService } from "./roteamento-whatsapp.service";

/**
 * Por qual serviço sai cada mensagem de WhatsApp, por empresa.
 *
 * Atrás de `PlataformaGuard` e **fora do catálogo de permissões**, de propósito
 * e pelo mesmo motivo da gestão de contas: trocar o provedor de uma rota muda
 * quanto ela custa e pode deixar motorista sem receber o código de cadastro.
 * Não é permissão que um administrador de empresa possa ganhar por engano numa
 * matriz de checkbox — e o `PermissaoGuard` é fail-open, enquanto este é
 * fail-closed.
 *
 * O `?contaId=` deixa a plataforma configurar em nome de qualquer empresa, do
 * mesmo jeito que o aviso de grupo.
 */
@ApiTags("admin/roteamento-whatsapp")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@Controller("admin/roteamento-whatsapp")
export class AdminRoteamentoWhatsappController {
  constructor(private readonly service: AdminRoteamentoWhatsappService) {}

  @Get()
  pegar(@CurrentUser() user: AuthUser, @Query("contaId") contaId?: string) {
    return comConta(contaAlvo(user, contaId), () => this.service.pegar());
  }

  /** Quanto saiu e quanto custou, por tipo de mensagem. */
  @Get("consumo")
  consumo(
    @CurrentUser() user: AuthUser,
    @Query("contaId") contaId?: string,
    @Query("dias") dias?: string,
  ) {
    const janela = Math.min(Math.max(Number(dias) || 30, 1), 180);
    return comConta(contaAlvo(user, contaId), () => this.service.consumo(janela));
  }

  /**
   * O payload real de cada rota, montado e não enviado. Confere um template
   * recém-aprovado sem esperar o cron das 20h.
   */
  @Get("payloads")
  payloads(
    @CurrentUser() user: AuthUser,
    @Query("contaId") contaId?: string,
    @Query("telefone") telefone?: string,
  ) {
    // Um número qualquer só pra montar o payload — nada sai daqui. O default
    // existe pra a tela abrir sem exigir que alguém digite um telefone.
    const numero = (telefone ?? "").replace(/\D/g, "") || "5541999998888";
    return comConta(contaAlvo(user, contaId), () => this.service.payloads(numero));
  }

  /** Os últimos envios que não saíram, com o motivo cru do provedor. */
  @Get("falhas")
  falhas(
    @CurrentUser() user: AuthUser,
    @Query("contaId") contaId?: string,
    @Query("limite") limite?: string,
  ) {
    return comConta(contaAlvo(user, contaId), () => this.service.falhas(Number(limite) || 20));
  }

  /**
   * Troca uma rota de PLATAFORMA. Não aceita `contaId`: a escolha é única e
   * vale pra todas as empresas — aceitar o parâmetro sugeriria o contrário.
   */
  @Put("plataforma")
  salvarPlataforma(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AtualizarRoteamentoPlataformaInput))
    body: AtualizarRoteamentoPlataformaInput,
  ) {
    // `comoSistema` porque a linha não tem conta; `pegar()` no fim precisa de
    // uma pra montar a resposta, então usa a do próprio usuário.
    return comConta(contaAlvo(user), () => this.service.salvarPlataforma(body.rotas, user.id));
  }

  /**
   * O que a Meta diz sobre o número. Responde "está registrado?" sem depender
   * do rótulo do console dela, que já mostrou os dois estados errados.
   */
  /** O que a Meta tem cadastrado de template, contra o que o código espera. */
  @Get("templates-meta")
  templatesMeta(@Query("wabaId") wabaId: string) {
    return this.service.templatesMeta(wabaId);
  }

  /**
   * `?phoneNumberId=` escolhe qual número olhar. Sem ele, o do env — que hoje
   * é o transacional, e não o que alguém está registrando agora.
   */
  @Get("status-numero")
  statusNumero(@Query("phoneNumberId") phoneNumberId?: string) {
    return this.service.statusNumero(phoneNumberId);
  }

  /**
   * Os números da WABA, cada um com a etapa em que parou.
   *
   * Com dois números (transacional e comercial) esta é a primeira tela a olhar:
   * diz o id de cada um — que é o que todo o resto do fluxo pede — e separa
   * "verificado" de "registrado na Cloud API", que o console trata como a
   * mesma coisa e não são.
   */
  @Get("numeros")
  numeros(@Query("wabaId") wabaId: string) {
    return this.service.numeros(wabaId);
  }

  /** Adiciona um número novo à WABA. Devolve o id que o resto do fluxo usa. */
  @Post("adicionar-numero")
  adicionarNumero(
    @Body(new ZodValidationPipe(AdicionarNumeroMetaInput)) body: AdicionarNumeroMetaInput,
  ) {
    return this.service.adicionarNumero(body);
  }

  /** Dispara o SMS (ou a ligação) de verificação pro chip. */
  @Post("solicitar-codigo")
  solicitarCodigo(
    @Body(new ZodValidationPipe(SolicitarCodigoMetaInput)) body: SolicitarCodigoMetaInput,
  ) {
    return this.service.solicitarCodigo(body.phoneNumberId, body.metodo, body.idioma);
  }

  /** Confirma o código recebido. Ele não é logado nem gravado. */
  @Post("verificar-codigo")
  verificarCodigo(
    @Body(new ZodValidationPipe(VerificarCodigoMetaInput)) body: VerificarCodigoMetaInput,
  ) {
    return this.service.verificarCodigo(body.phoneNumberId, body.codigo);
  }

  /**
   * Quem está inscrito nos webhooks da WABA. Sem isto, "a mensagem não chega"
   * e "o webhook está configurado" convivem sem contradição aparente: a URL
   * responde ao teste do console e mesmo assim nenhum evento real sai da Meta.
   */
  @Get("apps-inscritos")
  appsInscritos(@Query("wabaId") wabaId: string) {
    return this.service.appsInscritos(wabaId);
  }

  /** Inscreve o app nos webhooks da WABA. Idempotente. */
  @Post("inscrever-webhook")
  inscreverWebhook(@Query("wabaId") wabaId: string) {
    return this.service.inscreverWebhook(wabaId);
  }

  /**
   * Tira o `override_callback_uri` da WABA e devolve a entrega pra URL do app.
   * Use quando uma ferramenta externa apontar o webhook pra ela mesma.
   */
  @Post("restaurar-webhook")
  restaurarWebhook(@Query("wabaId") wabaId: string) {
    return this.service.restaurarWebhook(wabaId);
  }

  /**
   * Registra o número na Cloud API. É a chamada que o botão do console
   * embrulha — aqui o erro da Meta volta por escrito em vez de sumir.
   *
   * O PIN vem no corpo e não é logado em lugar nenhum.
   */
  @Post("registrar-numero")
  registrarNumero(
    @Body(new ZodValidationPipe(RegistrarNumeroMetaInput)) body: RegistrarNumeroMetaInput,
  ) {
    return this.service.registrarNumero(body.pin, body.phoneNumberId);
  }

  @Put()
  salvar(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AtualizarRoteamentoWhatsappInput))
    body: AtualizarRoteamentoWhatsappInput,
    @Query("contaId") contaId?: string,
  ) {
    return comConta(contaAlvo(user, contaId), () => this.service.salvar(body, user.id));
  }
}
