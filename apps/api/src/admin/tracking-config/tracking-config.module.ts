import { Module } from "@nestjs/common";
import { TrackingConfigController } from "./tracking-config.controller";
import { TrackingConfigService } from "./tracking-config.service";

@Module({
  controllers: [TrackingConfigController],
  providers: [TrackingConfigService],
  exports: [TrackingConfigService],
})
export class TrackingConfigModule {}
