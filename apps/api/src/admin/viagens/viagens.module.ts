import { Module } from "@nestjs/common";
import { ViagensAdminController } from "./viagens.controller";
import { ViagensAdminService } from "./viagens.service";

@Module({
  controllers: [ViagensAdminController],
  providers: [ViagensAdminService],
})
export class ViagensAdminModule {}
