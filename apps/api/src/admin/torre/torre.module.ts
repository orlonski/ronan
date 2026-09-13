import { Module } from "@nestjs/common";
import { AdminInboxModule } from "../inbox/inbox.module";
import { TorreController } from "./torre.controller";
import { TorreService } from "./torre.service";

@Module({
  imports: [AdminInboxModule],
  controllers: [TorreController],
  providers: [TorreService],
  exports: [TorreService],
})
export class TorreModule {}
