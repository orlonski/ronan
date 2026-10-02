import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { EvolutionModule } from "../whatsapp/evolution.module";
import { AuditoriaModule } from "../auditoria/auditoria.module";
import { AdminInboxModule } from "../admin/inbox/inbox.module";
import { PedidosModule } from "../admin/pedidos/pedidos.module";
import { EncarregadoController } from "./encarregado.controller";
import { EncarregadosAdminController, SolicitacoesObraController } from "./encarregado-admin.controller";
import { EncarregadoAuthService } from "./encarregado-auth.service";
import { EncarregadoPortalService } from "./encarregado-portal.service";
import { EncarregadosAdminService } from "./encarregados-admin.service";
import { SolicitacoesObraService } from "./solicitacoes-obra.service";
import { EncarregadoGuard } from "./encarregado.guard";

/**
 * Portal da obra: o encarregado do CLIENTE acompanha a obra pelo celular
 * (`encarregado/*`, público com sessão própria) e o escritório gerencia quem
 * entra e responde os pedidos de caminhão (`admin/*`). Os dois lados no mesmo
 * módulo pelo mesmo motivo do comprovante público: o whitelist fica colado em
 * quem o consome.
 */
@Module({
  imports: [UploadsModule, EvolutionModule, AuditoriaModule, AdminInboxModule, PedidosModule],
  controllers: [EncarregadoController, EncarregadosAdminController, SolicitacoesObraController],
  providers: [
    EncarregadoAuthService,
    EncarregadoPortalService,
    EncarregadosAdminService,
    SolicitacoesObraService,
    EncarregadoGuard,
  ],
})
export class EncarregadoModule {}
