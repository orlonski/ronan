import { Global, Module } from "@nestjs/common";
import { ClienteIaFactory } from "./cliente-ia";
import { IaService } from "./ia.service";
import { TranscricaoService } from "./transcricao.service";
import { UsoIaService } from "./uso-ia.service";

@Global()
@Module({
  providers: [ClienteIaFactory, IaService, TranscricaoService, UsoIaService],
  exports: [ClienteIaFactory, IaService, TranscricaoService, UsoIaService],
})
export class IaModule {}
