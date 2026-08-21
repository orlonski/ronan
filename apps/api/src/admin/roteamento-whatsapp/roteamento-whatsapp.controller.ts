import { Body, Controller, Get, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AtualizarRoteamentoPlataformaInput,
  AtualizarRoteamentoWhatsappInput,
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
