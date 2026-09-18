import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { TermosAdminController } from "./termos-admin.controller";
import { TermosController } from "./termos.controller";
import { TermosService } from "./termos.service";

@Module({
  imports: [PrismaModule],
  controllers: [TermosController, TermosAdminController],
  providers: [TermosService],
  exports: [TermosService],
})
export class TermosModule {}
