import { Module } from "@nestjs/common";
import { PushModule } from "../push/push.module";
import { UploadsModule } from "../uploads/uploads.module";
import { ChatService } from "./chat.service";
import { ChatAudioCleanupService } from "./chat-audio-cleanup.service";
import { ChatAdminService } from "./chat-admin.service";
import { ChatMotoristaController } from "./chat-motorista.controller";
import { ChatAdminController } from "./chat-admin.controller";

@Module({
  imports: [PushModule, UploadsModule],
  controllers: [ChatMotoristaController, ChatAdminController],
  providers: [ChatService, ChatAdminService, ChatAudioCleanupService],
  exports: [ChatService],
})
export class ChatModule {}
