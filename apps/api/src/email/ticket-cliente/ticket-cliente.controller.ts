import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ConfigEnvioTicketInput, EnviarTesteTicketInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { TicketClienteService } from "./ticket-cliente.service";

/**
 * Configuração do ticket por e-mail no cadastro do cliente pagador e da obra.
 *
 * Reaproveita as permissões do próprio cadastro (ver/editar cliente e obra) em
 * vez de criar chave nova: quem pode mudar o e-mail de contato do cliente já
 * decide pra onde vão os dados dele. "Enviar teste" é escrita — manda e-mail
 * pra fora — então pede o editar.
 */
@ApiTags("admin/envio-ticket")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/envio-ticket")
export class TicketClienteController {
  constructor(private readonly service: TicketClienteService) {}

  @RequerPermissao("empresas.ver")
  @Get("empresas/:id")
  configPagador(@Param("id") id: string) {
    return this.service.configPagador(id);
  }

  @RequerPermissao("empresas.editar")
  @Put("empresas/:id")
  salvarPagador(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ConfigEnvioTicketInput)) body: ConfigEnvioTicketInput,
  ) {
    return this.service.salvarPagador(id, body);
  }

  @RequerPermissao("empresas.editar")
  @Post("empresas/:id/teste")
  testePagador(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarTesteTicketInput)) body: EnviarTesteTicketInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.enviarTeste({ empresaId: id }, body.emails, user.id);
  }

  @RequerPermissao("clientes.ver")
  @Get("obras/:id")
  configObra(@Param("id") id: string) {
    return this.service.configObra(id);
  }

  @RequerPermissao("clientes.editar")
  @Put("obras/:id")
  salvarObra(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ConfigEnvioTicketInput)) body: ConfigEnvioTicketInput,
  ) {
    return this.service.salvarObra(id, body);
  }

  @RequerPermissao("clientes.editar")
  @Post("obras/:id/teste")
  testeObra(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarTesteTicketInput)) body: EnviarTesteTicketInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.enviarTeste({ clienteId: id }, body.emails, user.id);
  }
}
