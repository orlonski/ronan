import { Module } from "@nestjs/common";
import { IntegracoesController } from "./integracoes.controller";
import { IntegracoesService } from "./integracoes.service";

@Module({
  controllers: [IntegracoesController],
  providers: [IntegracoesService],
})
export class IntegracoesModule {}
