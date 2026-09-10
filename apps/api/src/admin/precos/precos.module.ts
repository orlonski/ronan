import { Module } from "@nestjs/common";
import { PrecosController } from "./precos.controller";
import { PrecosService } from "./precos.service";

@Module({
  controllers: [PrecosController],
  providers: [PrecosService],
  exports: [PrecosService],
})
export class PrecosModule {}
