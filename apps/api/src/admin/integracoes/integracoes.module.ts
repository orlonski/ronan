import { Module } from "@nestjs/common";
import { IntegracoesController, RegistroAlteracoesController } from "./integracoes.controller";
import { IntegracoesService } from "./integracoes.service";
import { AvisosAdminService, RegistroAlteracoesService } from "./avisos-admin.service";

@Module({
  controllers: [IntegracoesController, RegistroAlteracoesController],
  providers: [IntegracoesService, AvisosAdminService, RegistroAlteracoesService],
})
export class IntegracoesModule {}
