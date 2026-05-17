import { Module } from "@nestjs/common";
import { NotificacoesAdminController } from "./notificacoes-admin.controller";
import { NotificacoesController } from "./notificacoes.controller";
import { NotificacoesService } from "./notificacoes.service";

@Module({
  controllers: [NotificacoesController, NotificacoesAdminController],
  providers: [NotificacoesService],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
