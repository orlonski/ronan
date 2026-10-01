import { Module } from "@nestjs/common";
import { CartaoCombustivelController } from "./cartao-combustivel.controller";
import { CartaoCombustivelService } from "./cartao-combustivel.service";

@Module({
  controllers: [CartaoCombustivelController],
  providers: [CartaoCombustivelService],
})
export class CartaoCombustivelModule {}
