import { Global, Module } from "@nestjs/common";
import { IaService } from "./ia.service";

@Global()
@Module({
  providers: [IaService],
  exports: [IaService],
})
export class IaModule {}
