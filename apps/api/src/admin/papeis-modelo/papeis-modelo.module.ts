import { Module } from "@nestjs/common";
import { PapeisModeloController } from "./papeis-modelo.controller";
import { PapeisModeloService } from "./papeis-modelo.service";

@Module({
  controllers: [PapeisModeloController],
  providers: [PapeisModeloService],
})
export class PapeisModeloModule {}
