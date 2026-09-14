import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AtualizarAssinaturaInput,
  BaixaManualInput,
  CancelarAssinaturaInput,
  CriarAssinaturaInput,
} from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { PlataformaGuard } from "../auth/guards/plataforma.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser } from "../auth/types";
import { IgnoraEscopo } from "../common/escopo/escopo.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AssinaturasService } from "./assinaturas.service";
import { ReguaCobrancaService } from "./regua-cobranca.service";

/**
 * A gestão das mensalidades, atrás do `PlataformaGuard`.
 *
 * Não passa pela matriz de permissões de propósito, e pelo mesmo motivo da
 * tabela de preço: isto é quanto a Movatruck cobra, não configuração de empresa
 * nenhuma. Um administrador de transportadora não pode nem ver, nem ganhar por
 * engano — e o boot-check aceita o guard como fechamento suficiente justamente
 * porque ele fecha MAIS do que a matriz fecharia.
 *
 * `@IgnoraEscopo` porque o escopo por transportadora filtra dados de operação;
 * aqui o assunto é a empresa inteira.
 */
@ApiTags("admin/assinaturas")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/assinaturas")
export class AssinaturasController {
  constructor(
    private readonly service: AssinaturasService,
    private readonly regua: ReguaCobrancaService,
  ) {}

  /**
   * Roda a régua de cobrança agora, sem esperar as 9h.
   *
   * Não é só conveniência de teste: quando o WhatsApp cai, os avisos do dia não
   * saem — e como um aviso que falha NÃO grava data, a régua os tentaria de
   * novo só no dia seguinte. Este botão recupera o dia.
   *
   * É idempotente pela mesma razão que o cron é: quem já foi avisado hoje não é
   * avisado de novo, porque a decisão olha a data gravada. Apertar duas vezes
   * não manda duas mensagens.
   */
  @Post("regua/rodar")
  rodarRegua() {
    return this.regua.passar();
  }

  @Get()
  listar() {
    return this.service.listar();
  }

  /** Quanto cobrar desta empresa, pela tabela de preço e o tamanho da frota. */
  @Get("sugestao/:contaId")
  sugerir(@Param("contaId") contaId: string) {
    return this.service.sugerir(contaId);
  }

  @Get(":id")
  detalhar(@Param("id") id: string) {
    return this.service.detalhar(id);
  }

  @Post()
  criar(
    @Body(new ZodValidationPipe(CriarAssinaturaInput)) body: CriarAssinaturaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criar(body, user.id);
  }

  /**
   * Tenta de novo levar pro gateway uma assinatura que ficou em rascunho.
   *
   * Existe porque a criação no gateway é o passo que falha (gateway fora do ar,
   * CNPJ recusado, chave Pix faltando) e recomeçar o cadastro inteiro por causa
   * disso seria digitar tudo de novo pra tentar a mesma coisa.
   */
  @Post(":id/espelhar")
  espelhar(@Param("id") id: string) {
    return this.service.espelharNoGateway(id);
  }

  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarAssinaturaInput)) body: AtualizarAssinaturaInput,
  ) {
    return this.service.atualizar(id, body);
  }

  /** Para de cobrar. NÃO tira a empresa do ar — isso é outra tela e outra decisão. */
  @Post(":id/cancelar")
  cancelar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CancelarAssinaturaInput)) body: CancelarAssinaturaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.cancelar(id, body.motivo, user.id);
  }

  /** O dinheiro entrou por fora do gateway (Pix na conta, TED). Exige motivo. */
  @Post("cobrancas/:cobrancaId/baixa")
  baixaManual(
    @Param("cobrancaId") cobrancaId: string,
    @Body(new ZodValidationPipe(BaixaManualInput)) body: BaixaManualInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.baixaManual(cobrancaId, body, user.id);
  }
}
