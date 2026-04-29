import { Module } from "@nestjs/common";
import { MateriaisModule } from "./materiais/materiais.module";
import { VeiculosModule } from "./veiculos/veiculos.module";
import { EmpresasModule } from "./empresas/empresas.module";
import { ObrasModule } from "./obras/obras.module";
import { MotoristasModule } from "./motoristas/motoristas.module";
import { UsersModule } from "./users/users.module";
import { LocaisModule } from "./locais/locais.module";

@Module({
  imports: [
    MateriaisModule,
    VeiculosModule,
    EmpresasModule,
    ObrasModule,
    MotoristasModule,
    UsersModule,
    LocaisModule,
  ],
})
export class AdminModule {}
