import { Module } from "@nestjs/common";
import { NotificacoesModule } from "../notificacoes/notificacoes.module";
import { PushService } from "./push.service";

@Module({
  imports: [NotificacoesModule],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
