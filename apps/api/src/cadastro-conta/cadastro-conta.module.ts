import { Module } from "@nestjs/common";
import { ContasModule } from "../admin/contas/contas.module";
import { AdminInboxModule } from "../admin/inbox/inbox.module";
import { EvolutionModule } from "../whatsapp/evolution.module";
import { CadastroContaController } from "./cadastro-conta.controller";
import { CadastroContaService } from "./cadastro-conta.service";

@Module({
  imports: [ContasModule, AdminInboxModule, EvolutionModule],
  controllers: [CadastroContaController],
  providers: [CadastroContaService],
})
export class CadastroContaModule {}
