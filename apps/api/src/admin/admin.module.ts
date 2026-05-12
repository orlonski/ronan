import { Module } from "@nestjs/common";
import { MateriaisModule } from "./materiais/materiais.module";
import { VeiculosModule } from "./veiculos/veiculos.module";
import { EmpresasModule } from "./empresas/empresas.module";
import { ObrasModule } from "./obras/obras.module";
import { MotoristasModule } from "./motoristas/motoristas.module";
import { UsersModule } from "./users/users.module";
import { LocaisModule } from "./locais/locais.module";
import { ViagensAdminModule } from "./viagens/viagens.module";
import { AbastecimentosAdminModule } from "./abastecimentos/abastecimentos.module";
import { TrackingConfigModule } from "./tracking-config/tracking-config.module";
import { IaConfigModule } from "./ia-config/ia-config.module";
import { AgenteConfigModule } from "./agente-config/agente-config.module";
import { LayoutImportModule } from "./layout-import/layout-import.module";
import { CamposLayoutModule } from "./campos-layout/campos-layout.module";
import { DashboardModule } from "./dashboard/dashboard.module";

@Module({
  imports: [
    MateriaisModule,
    VeiculosModule,
    EmpresasModule,
    ObrasModule,
    MotoristasModule,
    UsersModule,
    LocaisModule,
    ViagensAdminModule,
    AbastecimentosAdminModule,
    TrackingConfigModule,
    IaConfigModule,
    AgenteConfigModule,
    LayoutImportModule,
    CamposLayoutModule,
    DashboardModule,
  ],
})
export class AdminModule {}
