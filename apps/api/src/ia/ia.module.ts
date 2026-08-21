import { Global, Module } from "@nestjs/common";
import { IaService } from "./ia.service";
import { TranscricaoService } from "./transcricao.service";
import { UsoIaService } from "./uso-ia.service";

@Global()
@Module({
  providers: [IaService, TranscricaoService, UsoIaService],
  exports: [IaService, TranscricaoService, UsoIaService],
})
export class IaModule {}
