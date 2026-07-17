import { Module } from "@nestjs/common";
import { ViagemMensagensService } from "./viagem-mensagens.service";

@Module({
  providers: [ViagemMensagensService],
  exports: [ViagemMensagensService],
})
export class ViagemMensagensModule {}
