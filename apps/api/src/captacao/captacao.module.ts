import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminInboxModule } from "../admin/inbox/inbox.module";
import { CaptacaoPublicoController } from "./captacao-publico.controller";
import { CaptacaoService } from "./captacao.service";

@Module({
  imports: [PrismaModule, AdminInboxModule],
  controllers: [CaptacaoPublicoController],
  providers: [CaptacaoService],
  exports: [CaptacaoService],
})
export class CaptacaoModule {}
