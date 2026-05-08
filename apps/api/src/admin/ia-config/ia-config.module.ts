import { Module } from "@nestjs/common";
import { IaConfigController } from "./ia-config.controller";
import { IaConfigService } from "./ia-config.service";

@Module({
  controllers: [IaConfigController],
  providers: [IaConfigService],
  exports: [IaConfigService],
})
export class IaConfigModule {}
