import { Module } from "@nestjs/common";
import { KmAtipicoConfigController } from "./km-atipico-config.controller";
import { KmAtipicoConfigService } from "./km-atipico-config.service";

@Module({
  controllers: [KmAtipicoConfigController],
  providers: [KmAtipicoConfigService],
  exports: [KmAtipicoConfigService],
})
export class KmAtipicoConfigModule {}
