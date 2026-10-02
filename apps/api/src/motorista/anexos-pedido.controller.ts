import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthMotorista } from "../auth/types";
import { RequerCapacidade } from "../common/acesso-app/capacidade.decorator";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { AnexosPedidoService } from "../admin/pedidos/anexos-pedido.service";

/**
 * Os documentos do pedido, do lado do motorista: croqui de acesso, autorização
 * de entrada. Só sai o que o escritório deixou visível, e só pra quem tem
 * programação desse pedido — senão 404 (a regra mora no service).
 */
@ApiTags("motorista/pedidos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/pedidos/:pedidoId/anexos")
@RequerCapacidade("app.pedido.anexos")
export class AnexosPedidoMotoristaController {
  constructor(private readonly service: AnexosPedidoService) {}

  /** O arquivo, com o token dele. O app guarda no aparelho pra abrir sem sinal. */
  @Get(":anexoId")
  async arquivo(
    @CurrentUser() user: AuthMotorista,
    @Param("pedidoId") pedidoId: string,
    @Param("anexoId") anexoId: string,
    @Res() res: Response,
  ) {
    const a = await this.service.doMotorista(user.id, pedidoId, anexoId);
    await this.service.servir(a, res);
  }

  /**
   * Link curto (10 min) pro leitor de PDF do celular.
   *
   * Existe por causa do Android: o app não tem leitor de PDF próprio, e
   * entregar o arquivo LOCAL a outro app exige permissão de leitura que a
   * ponte do React Native não concede. Um link https o sistema abre sozinho —
   * sem módulo nativo novo, então chega por OTA.
   */
  @Get(":anexoId/link")
  async link(
    @CurrentUser() user: AuthMotorista,
    @Param("pedidoId") pedidoId: string,
    @Param("anexoId") anexoId: string,
  ) {
    const a = await this.service.doMotorista(user.id, pedidoId, anexoId);
    return { caminho: this.service.linkAssinado(a.id, user.contaId) };
  }
}

const limiteLink = criarRateLimitIpGuard({ limitePorMinuto: 60, nome: "anexo-pedido" });

/**
 * O PDF pelo link assinado — sem sessão, quem autoriza é o token (que carrega
 * a conta e vence em 10 minutos).
 *
 * ⚠️ Sem `@RequerPermissao` de propósito: o `PermissaoGuard` não olha
 * `@Public()` e daria 403 pra todo mundo.
 */
@ApiExcludeController()
@Public()
@Controller("publico/anexos-pedido")
export class AnexoPedidoPublicoController {
  constructor(private readonly service: AnexosPedidoService) {}

  @UseGuards(limiteLink)
  @Get(":token")
  async arquivo(@Param("token") token: string, @Res() res: Response) {
    const a = await this.service.peloLink(token);
    await this.service.servir(a, res);
  }
}
