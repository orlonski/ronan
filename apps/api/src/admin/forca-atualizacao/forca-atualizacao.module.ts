import { Module } from "@nestjs/common";
import { ForcaAtualizacaoController } from "./forca-atualizacao.controller";
import { ForcaAtualizacaoService } from "./forca-atualizacao.service";

@Module({
  controllers: [ForcaAtualizacaoController],
  providers: [ForcaAtualizacaoService],
  exports: [ForcaAtualizacaoService],
})
export class ForcaAtualizacaoModule {}
