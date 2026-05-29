import { Module } from "@nestjs/common";
import { FrotaAdminController } from "./frota.controller";
import { FrotaAdminService } from "./frota.service";

@Module({
  controllers: [FrotaAdminController],
  providers: [FrotaAdminService],
})
export class FrotaAdminModule {}
