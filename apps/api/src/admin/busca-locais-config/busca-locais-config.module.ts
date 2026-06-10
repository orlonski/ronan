import { Module } from "@nestjs/common";
import { BuscaLocaisConfigController } from "./busca-locais-config.controller";
import { BuscaLocaisConfigService } from "./busca-locais-config.service";

@Module({
  controllers: [BuscaLocaisConfigController],
  providers: [BuscaLocaisConfigService],
  exports: [BuscaLocaisConfigService],
})
export class BuscaLocaisConfigModule {}
