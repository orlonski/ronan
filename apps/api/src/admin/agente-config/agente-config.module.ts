import { Module } from "@nestjs/common";
import { AgenteConfigController } from "./agente-config.controller";
import { AgenteConfigService } from "./agente-config.service";

@Module({
  controllers: [AgenteConfigController],
  providers: [AgenteConfigService],
  exports: [AgenteConfigService],
})
export class AgenteConfigModule {}
