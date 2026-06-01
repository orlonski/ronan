import { Module } from "@nestjs/common";
import { AdminInboxController } from "./inbox.controller";
import { AdminInboxService } from "./inbox.service";

@Module({
  controllers: [AdminInboxController],
  providers: [AdminInboxService],
  exports: [AdminInboxService],
})
export class AdminInboxModule {}
