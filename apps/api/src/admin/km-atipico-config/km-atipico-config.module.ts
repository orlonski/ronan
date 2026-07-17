import { Module } from "@nestjs/common";
import { KmAtipicoModule } from "../../km-atipico/km-atipico.module";
import { KmAtipicoConfigController } from "./km-atipico-config.controller";
import { KmAtipicoConfigService } from "./km-atipico-config.service";

@Module({
  imports: [KmAtipicoModule],
  controllers: [KmAtipicoConfigController],
  providers: [KmAtipicoConfigService],
  exports: [KmAtipicoConfigService],
})
export class KmAtipicoConfigModule {}
