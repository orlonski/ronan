import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../auditoria/auditoria.module";
import { AdminInboxModule } from "../admin/inbox/inbox.module";
import { CobrancaClienteController } from "./cobranca-cliente.controller";
import { CobrancaClienteService } from "./cobranca-cliente.service";
import { WebhookCobrancaClienteController } from "./webhook-cobranca-cliente.controller";
import { WebhookCobrancaClienteGuard } from "./webhook-cobranca-cliente.guard";

/**
 * Boleto/Pix da fatura do cliente pelo Asaas DA transportadora (a chave é dela,
 * o dinheiro cai na conta dela). Não confundir com `assinaturas/`, que é a
 * Movatruck cobrando a mensalidade com a chave da Movatruck.
 */
@Module({
  imports: [AuditoriaModule, AdminInboxModule],
  controllers: [CobrancaClienteController, WebhookCobrancaClienteController],
  providers: [CobrancaClienteService, WebhookCobrancaClienteGuard],
})
export class CobrancaClienteModule {}
