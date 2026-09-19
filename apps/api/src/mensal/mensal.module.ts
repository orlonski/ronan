import { Module } from "@nestjs/common";
import { MensalAdminController, ObraMotoristaController } from "./mensal.controller";
import { MensalService } from "./mensal.service";

@Module({
  controllers: [MensalAdminController, ObraMotoristaController],
  providers: [MensalService],
  exports: [MensalService],
})
export class MensalModule {}
