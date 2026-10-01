import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AtualizarConfigConferenciaDiariaSchema,
  CalendarioConferenciaQuerySchema,
  ConfirmarTelefonesSchema,
  DecidirSugestaoGestorSchema,
  DefinirRecebimentoConferenciaSchema,
  PerguntaDeTesteSchema,
} from "@ronan/shared-types";
import type {
  AtualizarConfigConferenciaDiaria,
  CalendarioConferenciaQuery,
  ConfirmarTelefones,
  DecidirSugestaoGestor,
  DefinirRecebimentoConferencia,
  PerguntaDeTeste,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { MotoristasService } from "../motoristas/motoristas.service";
import { ConferenciaAlcanceService } from "./conferencia-alcance.service";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";

/**
 * Conferência diária de viagens: configuração, lista do dia e a fila do gestor.
 *
 * O `ModuloGuard` global deriva o módulo (`conferencia`) da permissão de cada
 * handler; por isso todo handler declara `@RequerPermissao`.
 */
@ApiTags("admin/conferencia-diaria")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/conferencia-diaria")
export class ConferenciaDiariaController {
  constructor(
    private readonly service: ConferenciaDiariaService,
    private readonly alcance: ConferenciaAlcanceService,
    private readonly motoristas: MotoristasService,
  ) {}

  @RequerPermissao("config-conferencia-diaria.ver")
  @Get("config")
  config() {
    return this.service.config();
  }

  @RequerPermissao("config-conferencia-diaria.editar")
  @Put("config")
  atualizarConfig(
    @Body(new ZodValidationPipe(AtualizarConfigConferenciaDiariaSchema))
    body: AtualizarConfigConferenciaDiaria,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizarConfig(body, user.id);
  }

  /** O que o job já registrou hoje: quem seria perguntado e por quê. */
  @RequerPermissao("conferencia-diaria.ver")
  @Get("hoje")
  hoje() {
    return this.service.listaDoDia();
  }

  /** Calcula agora com a regra salva, sem gravar. POST porque é uma execução, não uma leitura. */
  @RequerPermissao("config-conferencia-diaria.editar")
  @HttpCode(200)
  @Post("simular")
  simular() {
    return this.service.simular();
  }

  /** A fila do gestor. `status` vazio = só as abertas. */
  @RequerPermissao("conferencia-diaria.ver")
  @Get("sugestoes")
  sugestoes(@Query("status") status?: string, @Query("tipo") tipo?: string) {
    return this.service.listarSugestoes({ status, tipo });
  }

  /** Quem parou de receber a pergunta e quem tem número que não entrega. */
  @RequerPermissao("conferencia-diaria.ver")
  @Get("sem-canal")
  semCanal() {
    return this.service.listarSemCanal();
  }

  /**
   * O calendário do mês na ficha do motorista: o que respondeu à pergunta e se
   * lançou a viagem depois. Só leitura. Motorista fora do escopo = 404.
   */
  @RequerPermissao("conferencia-diaria.ver")
  @Get("motoristas/:id/calendario")
  async calendario(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(CalendarioConferenciaQuerySchema)) query: CalendarioConferenciaQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    await this.motoristas.findOne(id, user.escopo);
    // "Dados técnicos" (wamid, trilha…) só pra quem também pode decidir.
    const tecnico = user.permissoes.includes("conferencia-diaria.decidir");
    return this.service.calendarioDoMotorista(id, query.mes, undefined, tecnico);
  }

  /**
   * O número do motorista está confirmado? (selo da ficha): por qual sinal, quem confirmou, se
   * responderam "número errado". Só leitura. Fora do escopo = 404.
   */
  @RequerPermissao("conferencia-diaria.ver")
  @Get("motoristas/:id/numero")
  async numero(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    await this.motoristas.findOne(id, user.escopo);
    return this.service.numeroDoMotorista(id);
  }

  /** "Confirmar número": o escritório garante que o telefone do cadastro é do motorista. Idempotente. Fora do escopo = 404. */
  @RequerPermissao("conferencia-diaria.decidir")
  @HttpCode(200)
  @Post("motoristas/:id/confirmar-telefone")
  async confirmarTelefone(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.confirmarTelefones([id], user, user.escopo);
  }

  /**
   * "Confirmar os N números desta lista": o mesmo, em lote (no máximo
   * `LIMITE_CONFIRMAR_TELEFONES_POR_CHAMADA` por chamada). Um motorista fora do escopo derruba a
   * chamada inteira com 404, sem confirmar ninguém.
   */
  @RequerPermissao("conferencia-diaria.decidir")
  @HttpCode(200)
  @Post("confirmar-telefones")
  async confirmarTelefones(
    @Body(new ZodValidationPipe(ConfirmarTelefonesSchema)) body: ConfirmarTelefones,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.confirmarTelefones(body.motoristaIds, user, user.escopo);
  }

  /**
   * Interruptor "Receber a conferência de viagens" por motorista. Vale SÓ pra
   * este vínculo (o "Parar" do motorista no WhatsApp vale em todos). Religar quem
   * o próprio motorista desligou exige motivo. Fora do escopo = 404.
   */
  @RequerPermissao("conferencia-diaria.decidir")
  @Patch("motoristas/:id/recebe")
  async definirRecebimento(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DefinirRecebimentoConferenciaSchema)) body: DefinirRecebimentoConferencia,
    @CurrentUser() user: AuthAdminUser,
  ) {
    await this.motoristas.findOne(id, user.escopo);
    return this.service.definirRecebimento(id, user, body);
  }

  /**
   * Ferramenta de operação e de teste: manda de novo a pergunta de HOJE pelo
   * WhatsApp. Só a linha de hoje; ver `reenviarPerguntaDeHoje` pelas regras.
   * Motorista fora do escopo = 404.
   */
  @RequerPermissao("conferencia-diaria.decidir")
  @HttpCode(200)
  @Post("motoristas/:id/reenviar-pergunta")
  async reenviarPergunta(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    await this.motoristas.findOne(id, user.escopo);
    return this.service.reenviarPerguntaDeHoje(id, user.id);
  }

  /**
   * "Enviar pergunta de teste": manda a pergunta a ESTE motorista agora, sem
   * depender do job nem da regra. Não exige a conferência ligada; exige a Meta,
   * o canal do motorista e o módulo. Corpo opcional `{ dia }` ("Perguntar sobre este dia":
   * passado, dentro da janela; senão 400). Sem corpo = último dia útil. Fora do escopo = 404.
   */
  @RequerPermissao("conferencia-diaria.decidir")
  @HttpCode(200)
  @Post("motoristas/:id/pergunta-de-teste")
  async perguntaDeTeste(
    @Param("id") id: string,
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(PerguntaDeTesteSchema.optional())) body?: PerguntaDeTeste,
  ) {
    await this.motoristas.findOne(id, user.escopo);
    return this.service.enviarPerguntaDeTeste(id, user.id, new Date(), body?.dia);
  }

  /**
   * "Aprovar" = fazer o que a sugestão propõe. Pra INATIVAR_VINCULO isso inativa o
   * vínculo, e por isso exige TAMBÉM `motoristas.editar` (conferido no serviço).
   */
  @RequerPermissao("conferencia-diaria.decidir")
  @HttpCode(200)
  @Post("sugestoes/:id/aprovar")
  aprovar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DecidirSugestaoGestorSchema)) body: DecidirSugestaoGestor,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.aprovarSugestao(id, user, body.motivo);
  }

  @RequerPermissao("conferencia-diaria.decidir")
  @HttpCode(200)
  @Post("sugestoes/:id/recusar")
  recusar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DecidirSugestaoGestorSchema)) body: DecidirSugestaoGestor,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.recusarSugestao(id, user, body.motivo);
  }

  /** O selo "WhatsApp suspeito" do cadastro: o gestor sabe que o número está certo e limpa. */
  @RequerPermissao("conferencia-diaria.decidir")
  @HttpCode(200)
  @Post("motoristas/:id/reverificar-whatsapp")
  async reverificar(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    // Passa pelo escopo do usuário: quem não enxerga o motorista não mexe nele.
    await this.motoristas.findOne(id, user.escopo);
    await this.alcance.reverificar(id, user.id);
    return { ok: true };
  }
}
