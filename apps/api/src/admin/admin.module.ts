import { Module } from "@nestjs/common";
import { DemandasModule } from "./demandas/demandas.module";
import { MateriaisModule } from "./materiais/materiais.module";
import { RegrasMinimoModule } from "./regras-minimo/regras-minimo.module";
import { ViagemLifecycleAdminModule } from "./viagem-lifecycle/viagem-lifecycle.module";
import { VeiculosModule } from "./veiculos/veiculos.module";
import { EmpresasModule } from "./empresas/empresas.module";
import { ClientesModule } from "./clientes/clientes.module";
import { MotoristasModule } from "./motoristas/motoristas.module";
import { UsersModule } from "./users/users.module";
import { LocaisModule } from "./locais/locais.module";
import { ViagensAdminModule } from "./viagens/viagens.module";
import { AbastecimentosAdminModule } from "./abastecimentos/abastecimentos.module";
import { TrackingConfigModule } from "./tracking-config/tracking-config.module";
import { IaConfigModule } from "./ia-config/ia-config.module";
import { AgenteConfigModule } from "./agente-config/agente-config.module";
import { BuscaLocaisConfigModule } from "./busca-locais-config/busca-locais-config.module";
import { KmAtipicoConfigModule } from "./km-atipico-config/km-atipico-config.module";
import { ForcaAtualizacaoModule } from "./forca-atualizacao/forca-atualizacao.module";
import { LayoutImportModule } from "./layout-import/layout-import.module";
import { CamposLayoutModule } from "./campos-layout/campos-layout.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { FrotaAdminModule } from "./frota/frota.module";
import { PedagiosRodoviaModule } from "./pedagios-rodovia/pedagios-rodovia.module";
import { AdminInboxModule } from "./inbox/inbox.module";
import { ResumoModule } from "./resumo/resumo.module";
import { PermissoesModule } from "./permissoes/permissoes.module";
import { PapeisModule } from "./papeis/papeis.module";

@Module({
  imports: [
    MateriaisModule,
    RegrasMinimoModule,
    ViagemLifecycleAdminModule,
    VeiculosModule,
    EmpresasModule,
    ClientesModule,
    MotoristasModule,
    UsersModule,
    LocaisModule,
    ViagensAdminModule,
    AbastecimentosAdminModule,
    TrackingConfigModule,
    IaConfigModule,
    AgenteConfigModule,
    BuscaLocaisConfigModule,
    KmAtipicoConfigModule,
    ForcaAtualizacaoModule,
    LayoutImportModule,
    CamposLayoutModule,
    DashboardModule,
    FrotaAdminModule,
    PedagiosRodoviaModule,
    AdminInboxModule,
    ResumoModule,
    PermissoesModule,
    PapeisModule,
    DemandasModule,
  ],
})
export class AdminModule {}
