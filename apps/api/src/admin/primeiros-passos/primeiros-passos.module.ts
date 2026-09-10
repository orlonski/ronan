import { Module } from "@nestjs/common";
import { PrimeirosPassosController } from "./primeiros-passos.controller";
import { PrimeirosPassosService } from "./primeiros-passos.service";

@Module({
  controllers: [PrimeirosPassosController],
  providers: [PrimeirosPassosService],
})
export class PrimeirosPassosModule {}
