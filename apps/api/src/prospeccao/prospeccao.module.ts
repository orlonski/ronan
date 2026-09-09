import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ProspeccaoController } from "./prospeccao.controller";
import { ProspeccaoService } from "./prospeccao.service";
import { RntrcService } from "./rntrc.service";

@Module({
  imports: [PrismaModule],
  controllers: [ProspeccaoController],
  providers: [ProspeccaoService, RntrcService],
  exports: [ProspeccaoService, RntrcService],
})
export class ProspeccaoModule {}
