import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../../auditoria/auditoria.module";
import { DespesasNucleoModule } from "../../despesas/despesas-nucleo.module";
import { DespesasAdminController, TiposDespesaController } from "./despesas-admin.controller";
import { DespesasAdminService } from "./despesas-admin.service";
import { TiposDespesaService } from "./tipos-despesa.service";

/** Gasto de viagem no painel (módulo `despesas`). */
@Module({
  imports: [AuditoriaModule, DespesasNucleoModule],
  controllers: [TiposDespesaController, DespesasAdminController],
  providers: [DespesasAdminService, TiposDespesaService],
})
export class DespesasAdminModule {}
