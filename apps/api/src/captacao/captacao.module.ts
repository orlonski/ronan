import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CaptacaoPublicoController } from "./captacao-publico.controller";
import { CaptacaoService } from "./captacao.service";

@Module({
  imports: [PrismaModule],
  controllers: [CaptacaoPublicoController],
  providers: [CaptacaoService],
  exports: [CaptacaoService],
})
export class CaptacaoModule {}
