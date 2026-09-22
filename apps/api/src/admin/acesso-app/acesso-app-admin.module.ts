import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AcessoAppAdminController } from "./acesso-app-admin.controller";
import { AcessoAppAdminService } from "./acesso-app-admin.service";

@Module({
  imports: [PrismaModule],
  controllers: [AcessoAppAdminController],
  providers: [AcessoAppAdminService],
})
export class AcessoAppAdminModule {}
