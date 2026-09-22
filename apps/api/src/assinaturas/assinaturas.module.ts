import { Module, type OnModuleInit } from "@nestjs/common";
import { AuditoriaModule } from "../auditoria/auditoria.module";
import { ContasModule } from "../admin/contas/contas.module";
import { PrecosModule } from "../admin/precos/precos.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { AsaasConfig } from "./asaas.config";
import { AsaasProvedor } from "./asaas.provedor";
import { AssinaturasController } from "./assinaturas.controller";
import { AssinaturasService } from "./assinaturas.service";
import { AvisoCobrancaService } from "./aviso-cobranca.service";
import { EventosGatewayService } from "./eventos-gateway.service";
import { PagamentoLinkService } from "./pagamento-link.service";
import { PagamentoPublicoController } from "./pagamento-publico.controller";
import { ReguaCobrancaService } from "./regua-cobranca.service";
import { PagamentosWebhookController } from "./webhook.controller";

/**
 * A mensalidade que a Movatruck cobra das empresas clientes.
 *
 * O módulo sobe mesmo sem credencial de gateway — e diz isso no boot. Sem
 * `ASAAS_API_KEY` nada é criado lá fora, o webhook recusa tudo e a régua não
 * manda nada; o resto da API (painel, app do motorista) segue igual.
 */
@Module({
  imports: [PrecosModule, AuditoriaModule, WhatsappModule, ContasModule],
  controllers: [AssinaturasController, PagamentosWebhookController, PagamentoPublicoController],
  providers: [
    AsaasConfig,
    AsaasProvedor,
    AssinaturasService,
    AvisoCobrancaService,
    EventosGatewayService,
    PagamentoLinkService,
    ReguaCobrancaService,
  ],
  exports: [AssinaturasService],
})
export class AssinaturasModule implements OnModuleInit {
  constructor(private readonly config: AsaasConfig) {}

  onModuleInit(): void {
    this.config.descreverNoBoot();
  }
}
