import { Module } from "@nestjs/common";
import { TiposServicoController } from "./tipos-servico.controller";
import { TiposServicoService } from "./tipos-servico.service";

@Module({
  controllers: [TiposServicoController],
  providers: [TiposServicoService],
})
export class TiposServicoModule {}
