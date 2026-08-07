import { Global, Module } from "@nestjs/common";
import { IaService } from "./ia.service";
import { TranscricaoService } from "./transcricao.service";

@Global()
@Module({
  providers: [IaService, TranscricaoService],
  exports: [IaService, TranscricaoService],
})
export class IaModule {}
