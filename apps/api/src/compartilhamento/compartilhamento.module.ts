import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { EvolutionModule } from "../whatsapp/evolution.module";
import { CompartilhamentoAdminController } from "./compartilhamento-admin.controller";
import { CompartilhamentoPublicoController } from "./compartilhamento-publico.controller";
import { CompartilhamentoService } from "./compartilhamento.service";

/**
 * Link público de comprovante de viagem. Módulo próprio (e não dentro de
 * admin/viagens) porque os dois públicos — painel e cliente sem login —
 * dividem o mesmo service, e porque isso mantém o whitelist de campos
 * fisicamente colado em quem o consome.
 */
@Module({
  imports: [UploadsModule, EvolutionModule],
  controllers: [CompartilhamentoAdminController, CompartilhamentoPublicoController],
  providers: [CompartilhamentoService],
})
export class CompartilhamentoModule {}
