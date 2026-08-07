import { Module } from "@nestjs/common";
import { PushModule } from "../push/push.module";
import { ChatService } from "./chat.service";
import { ChatAdminService } from "./chat-admin.service";
import { ChatMotoristaController } from "./chat-motorista.controller";
import { ChatAdminController } from "./chat-admin.controller";

@Module({
  imports: [PushModule],
  controllers: [ChatMotoristaController, ChatAdminController],
  providers: [ChatService, ChatAdminService],
  exports: [ChatService],
})
export class ChatModule {}
